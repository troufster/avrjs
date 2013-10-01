//port of https://github.com/kiansheik/ard/tree/master/trunk/src/emulator
//https://github.com/dwelch67/avriss/blob/master/avriss.c
//https://github.com/buserror-uk/simavr/blob/master/simavr/sim/sim_core.c

var fs = require('fs');
var ihex = require('intel-hex');
var debug = 1;


var Dbg = {
  log : function() {
    var args = [].slice.call(arguments);

    console.log.apply(console, args);
  }
};

var SPL = 0x5d,  //(0x3D + 0x20)
 SPH = 0x5e, //(0x3E + 0x20)
 SREG = 0x5f, //(0x3F + 0x20)
 CBIT = 1 << 0,
 ZBIT = 1 << 1,
 NBIT = 1 << 2,
 VBIT = 1 << 3,
 SBIT = 1 << 4,
 HBIT = 1 << 5,
 TBIT = 1 << 6,
 IBIT = 1 << 7,
 RX_L = 26,
 RX_H = 27,
 RY_L = 28,
 RY_H = 29,
 RZ_L = 30,
 RZ_H = 31;


function Sreg() {
  this.C = false;
  this.Z = false;
  this.N = false;
  this.V = false;
  this.S = false;
  this.H = false;
  this.T = false;
  this.I = false;

  this.c = function() {return +this.C};
  this.z = function() {return +this.Z};
  this.n = function() {return +this.N};
  this.v = function() {return +this.V};
  this.s = function() {return +this.S};
  this.h = function() {return +this.H};
  this.t = function() {return +this.T};
  this.i = function() {return +this.I};

  this.nameFromBit = function(n) {
    return "CZNVSHTI"[n];
  };

  this.valueFromBit = function(n) {
    var name = "cznvshti"[n];
    return this[name]();
  };

  this.setFromBit = function(n,v){
    var name = this.nameFromBit(n);
    this[name] = v;
  };

  this.setFromVal = function(v) {

  }
}

function Processor() {
  /**
   * Data memory
   * 0x0000 - 0x001f -> registers
   * 0x0020 - 0x005f -> 64 I/O registers
   * 0x0060 - 0x00ff -> 160 external I/O registers
   * 0x0100 - 0x02ff -> 512 bytes of internal SRAM
   */

  this.memProg = new Uint16Array(0x800);
  this.memData = new Uint8Array(0xffff);
  this.SP = 0xffff;
  this.PC = 0;
  this.CYCLES = 0;
  this.STEP = 0;

  this.sreg = new Sreg();

  this.reset();
}

Processor.prototype = {
  reset : function() {
    //
    this.memData = new Uint8Array(0xffff);

    //reset stack pointer
    this.CYCLES = 0;
    this.PC = 0;
    this.SP = 0xffff;
    this.resetSReg();
  },
  resetSReg : function() {
    //this.sreg = 0x0;
  },
  getAddCarry : function(res, rd, rr, b) {
    var resb = res >> b & 0x1;
    var rdb = rd >> b & 0x1;
    var rrb = rr >> b & 0x1;
    return (rdb & rrb) | (rrb & ~resb) | (~resb & rdb);
  },
  getAddOverflow : function(res, rd, rr) {
    var res7 = res >> 7 & 0x1;
    var rd7 = rd >> 7 & 0x1;
    var rr7 = rr >> 7 & 0x1;
    return (rd7 & rr7 & ~res7) | (~rd7 & ~rr7 & res7);
  },
  getSubCarry : function(res, rd,rr,b) {
    var resb = res >> b & 0x1;
    var rdb = rd >> b & 0x1;
    var rrb = rr >> b & 0x1;
    return (~rdb & rrb) | (rrb & resb) | (resb & ~rdb);
  },
  getSubOverFlow: function(res,rd,rr) {
    var res7 = res >> 7 & 0x1;
    var rd7 = rd >> 7 & 0x1;
    var rr7 = rr >> 7 & 0x1;
    return (rd7 & ~rr7 & ~res7) | (~rd7 & rr7 & res7);
  },
  getCompareCarry : function(res, rd, rr, b) {
    var resb = (res >> b) & 0x1;
    var rdb = (rd >> b) & 0x1;
    var rrb = (rr >> b) & 0x1;
    return (~rdb & rrb) | (rrb & resb) | (resb & ~rdb);
  },
  getCompareOverflow : function(res, rd, rr) {
    res >>= 7; rd >>= 7; rr >>= 7;
    /* The atmel data sheet says the second term is ~rd7 for CP
     * but that doesn't make any sense. You be the judge. */
    return (rd & ~rr & ~res) | (~rd & rr & res);
  },
  is32bits : function(memprog,pc) {
    var o = (memprog[pc] | (memprog[pc+1] << 8)) & 0xfc0f;
    return	o == 0x9200 || // STS ! Store Direct to Data Space
      o == 0x9000 || // LDS Load Direct from Data Space
      o == 0x940c || // JMP Long Jump
      o == 0x940d || // JMP Long Jump
      o == 0x940e ||  // CALL Long Call to sub
      o == 0x940f; // CALL Long Call to sub
  },
  getRd10 : function(o, memdata) {
    var r = ((o >> 5) & 0x10) | (o & 0xf);
    var d = (o >> 4) & 0x1f;
    var vd = memdata[d], vr = memdata[r];

    return [r, d, vd, vr];
  },
  getRdd10 : function(o, memdata) {
    var r = ((o >> 5) & 0x10) | (o & 0xf);
    var d = (o >> 4) & 0x1f;
    var vr = memdata[r];

    return [r, d, vr];
  },
  getKr16 : function(o) {
    var r= 16 + ((o >> 4) & 0xf);
    var k = ((o & 0x0f00) >> 4) | (o & 0xf);

    return [r, k];
  },
  setReg : function(r,v) {
    //Hook stuff here in future
    this.memData[r] = v;
  },
  log : function() {
    if(debug && console) {
      var args = [].slice.call(arguments);
      //console.log.apply(console, args);
      Dbg.log.apply(null, args);
    }
  },
  state : function() {

  },
  invalidOpcode : function(opcode) {
    throw new Error("Unsupported instruction " + opcode + " " + opcode.toString(16)+ " " + opcode.toString(2));
  },
  notImplemented : function(o) {
    throw new Error("Not implemented OP:"+o);
  },
  run : function() {
    var memProg = this.memProg;
    var memData = this.memData;
    var log = this.log;
    var sreg = this.sreg;

    var opcode = (memProg[this.PC + 1] << 8) | memProg[this.PC];

    if(debug) if(debug) log("--opcode--> 0x" + opcode.toString(16));

    var new_pc = this.PC + 2;
    var cycle = 1;

    switch (opcode & 0xf000) {
      case 0x0000:

        switch (opcode) {
          case 0x0000: 	// NOP
            if(debug) log("NOP");
            break;
          default:

            switch (opcode & 0xfc00) {
              case 0x0400:// CPC compare with carry 0000 01rd dddd rrrr
                //[r, d, vd, vr];
                var v = this.getRd10(opcode, memData);

                var r = v[0];
                var d = v[1];
                var vd = v[2];
                var vr = v[3];

                var res = vd - vr - sreg.c();

                if(debug) log("CPC r" + d + " , r" + r);

                if(res) {
                  sreg.Z = 0;
                }

                sreg.H = this.getCompareCarry(res, vd, vr, 3);
                sreg.V = this.getCompareOverflow(res, vd, vr);
                sreg.N = (res >> 7) & 1;
                sreg.C = this.getCompareCarry(res, vd, vr, 7);
                sreg.S = sreg.n() ^ sreg.v();
                break;
              case 0x0c00: // ADD without carry 0000 11 rd dddd rrrr
                //[r, d, vd, vr];
                var rd = this.getRd10(opcode, memData);
                var r = rd[0];
                var d = rd[1];
                var vd = rd[2];
                var vr = rd[3];

                var res = vd + vr;

                if (r == d) {
                  if(debug) log("LSL r" + d);
                } else {
                  if(debug) log("ADD r" + d+ ", r " + r);
                }

                this.setReg(d, res);


                sreg.Z = res == 0;
                sreg.H = this.getAddCarry(res, vd, vr, 3);
                sreg.V = this.getAddOverflow(res, vd, vr);
                sreg.N = (res >> 7) & 1;
                sreg.C = this.getAddCarry(res, vd, vr, 7);
                sreg.S = sreg.n() ^ sreg.v();
                break;
              case 0x0800:	// SBC subtract with carry 0000 10rd dddd rrrr
                //  return [r, d, vd, vr];
                var rd =  this.getRd10(opcode,memData);
                var r = rd[0], d = rd[1], vd = rd[2], vr = rd[3];

                varres = vd - vr - sreg.c();
                if(debug) log("sbc r" + d + ", r" +r);

                this.setReg(d, res);

                if (res)
                  sreg.Z = 0;

                sreg.H = this.getSubCarry(res, vd, vr, 3);
                sreg.V = this.getSubOverFlow(res, vd, vr);
                sreg.N = (res >> 7) & 1;
                sreg.C = this.getSubCarry(res, vd, vr, 7);
                sreg.S = sreg.n() ^ sreg.v();

                break;
              default:

                switch (opcode & 0xff00) {
                  case 0x0100: 	// MOVW – Copy Register Word 0000 0001 dddd rrrr
                    var d = ((opcode >> 4) & 0xf) << 1;
                    var r = ((opcode) & 0xf) << 1;

                    if(debug) log("MOVW r" + d + ", r" + r);

                    this.setReg(d, memData[r]);
                    this.setReg(d+1, memData[r+1]);

                    break;
                  case 0x0200: // MULS – Multiply Signed 0000 0010 dddd rrrr
                    this.notImplemented("MULS");
                    break;
                  case 0x0300: 	// MUL Multiply 0000 0011 fddd frrr
                    this.notImplemented("MUL");

                    switch (opcode & 0x88) {
                      case 0x00: 	// MULSU – Multiply Signed Unsigned 0000 0011 0ddd 0rrr
                        this.notImplemented("MULSU");
                        break;
                      case 0x08: 	// FMUL Fractional Multiply Unsigned 0000 0011 0ddd 1rrr
                        this.notImplemented("FMUL");
                        break;
                      case 0x80: 	// FMULS – Multiply Signed  0000 0011 1ddd 0rrr
                        this.notImplemented("FMULS");
                        break;
                      case 0x88: 	// FMULSU – Multiply Signed Unsigned 0000 0011 1ddd 1rrr
                        this.notImplemented("FMULSU");
                        break;
                    }

                    break;
                  default:
                    this.invalidOpcode(opcode)
                }
            }
        }

        break;

      case 0x1000:

        switch (opcode & 0xfc00) {
          case 0x1800: 	// SUB without carry 0000 10 rd dddd rrrr

            //  return [r, d, vd, vr];
            var rd = this.getRd10(opcode, memData);
            var r = rd[0], d = rd[1], vd = rd[2], vr = rd[3];

            var res = vd - vr;
            if(debug) log("sub r" + d + ", r" +r);

            this.setReg(d, res);
            sreg.Z = res == 0;
            sreg.H = this.getSubCarry(res, vd, vr, 3);
            sreg.V = this.getSubOverFlow(res, vd, vr);
            sreg.N = (res >> 7) & 1;
            sreg.C = this.getSubCarry(res, vd, vr, 7);
            sreg.S = sreg.n() ^ sreg.v();

            break;
          case 0x1000: 	// CPSE Compare, skip if equal 0000 00 rd dddd rrrr
            this.notImplemented("CPSE");
            break;
          case 0x1400: 	// CP Compare 0000 01 rd dddd rrrr
            //  return [r, d, vd, vr];
            var rd = this.getRd10(opcode, memData);
            var r = rd[0];
            var d = rd[1];
            var vd = rd[2];
            var vr = rd[3];

            var res = vd - vr;
            if(debug) log("cp r" + d + ", r" + r);

            sreg.Z = res == 0;
            sreg.H = this.getCompareCarry(res, vd, vr, 3);
            sreg.V = this.getCompareOverflow(res, vd, vr);
            sreg.N = res >> 7;
            sreg.C = this.getCompareCarry(res, vd, vr, 7);
            sreg.S = sreg.n() ^ sreg.v();
            break;
          case 0x1c00:	// ADD with carry 0001 11 rd dddd rrrr

            //[r, d, vd, vr];
            var rd = this.getRd10(opcode, memData);
            var r = rd[0];
            var d = rd[1];
            var vd = rd[2];
            var vr = rd[3];


            var res = vd + vr + sreg.c();

            if (r == d) {
              if(debug) log("rol r" +d);
            } else {
              if(debug) log("addc r" + d + ", r" + r);
            }

            this.setReg(d, res);

            sreg.Z = res == 0;
            sreg.H = this.getAddCarry(res, vd, vr, 3);
            sreg.V = this.getAddOverflow(res, vd, vr);
            sreg.N = (res >> 7) & 1;
            sreg.C = this.getAddCarry(res, vd, vr, 7);
            sreg.S = sreg.n() ^ sreg.v();

            break;
          default:
            this.invalidOpcode(opcode);
        }

        break;

      case 0x2000:

        switch (opcode & 0xfc00) {
          case 0x2000: 	// AND	0010 00rd dddd rrrr
            //[r, d, vd, vr];
            var rd = this.getRd10(opcode, memData);
            var r = rd[0];
            var d = rd[1];
            var vd = rd[2];
            var vr = rd[3];

            var res = vd & vr;
            if (r == d) {
              if(debug) log("TST r"+d);
            } else {
              if(debug) log("AND r" + d + ", r" +r);
            }

            this.setReg(d, res);

            sreg.Z = res == 0;
            sreg.N = (res >> 7) & 1;
            sreg.V = 0;
            sreg.S = sreg.n() ^ sreg.v();
            break;
          case 0x2400: 	// EOR	0010 01rd dddd rrrr

            //[r, d, vd, vr];
            var d = this.getRd10(opcode, memData);
            var res = d[2] ^ d[3];

            if (d[0]==d[1]) {
              if(debug) log("CLR(EOR) r" + d[1], memData[d[1]]);
            } else {
              if(debug) log("EOR r" + d[1] + ", " + d[0]);
            }

            this.setReg(d[1], res);

            sreg.Z = res == 0;
            sreg.N = (res >> 7) & 1;
            sreg.V = 0;
            sreg.S = sreg.n() ^ sreg.v();

            break;
          case 0x2800: 	// OR Logical OR	0010 10rd dddd rrrr
            this.notImplemented("OR");
            break;
          case 0x2c00: 	// MOV	0010 11rd dddd rrrr
            //[r, d, vr];
            var rdd = this.getRdd10(opcode, memData);
            var r = rdd[0];
            var d = rdd[1];
            var vr = rdd[2];

            var res = vr;
            if(debug) log("MOV r" + d + " , r" + r);
            this.setReg(d, res);
            break;
          default:
            this.invalidOpcode(opcode);
        }

        break;

      case 0x3000:	// CPI 0011 KKKK rrrr KKKK
        // return [r, k];
        var rk = this.getKr16(opcode);
        var r = rk[0];
        var k = rk[1];
        var vr = memData[r];
        var res = vr - k;

        if(debug) log("CPI r" + r + " , 0x" + k.toString(16));

        sreg.Z = res == 0;
        sreg.H = this.getCompareCarry(res, vr, k, 3);
        sreg.V = this.getCompareOverflow(res,vr,k);
        sreg.N = (res >> 7) & 1;
        sreg.C = this.getCompareCarry(res, vr, k, 7);
        sreg.S = sreg.n() ^ sreg.v();
        break;

      case 0x4000: 	// SBCI Subtract Immediate With Carry 0101 10 kkkk dddd kkkk
        //[r, k];
        var kr16 = this.getKr16(opcode);

        var r = kr16[0];
        var k = kr16[1];

        var vr = memData[r];
        var res = vr - k - sreg.c();
        if(debug) log("SBCI r" + r + ", 0x" + k.toString(16));

        this.setReg(r, res);

        if (res) {
          sreg.Z = 0;
        }

        sreg.N = (res >> 7) & 1;
        sreg.C = (k + sreg.c()) > vr;
        sreg.S = sreg.n() ^ sreg.v();
        break;

      case 0x5000: 	// SUB Subtract Immediate 0101 10 kkkk dddd kkkk
        //[r, k];
        var kr16 = this.getKr16(opcode);

        var r = kr16[0];
        var k = kr16[1];

        var vr = memData[r];
        var res = vr - k;
        if(debug) log("SUBI r" + r + ", 0x" + k.toString(16));
        this.setReg(r, res);

        sreg.Z = res == 0;
        sreg.N = (res >> 7) & 1;
        sreg.C = k > vr;
        sreg.S = sreg.n() ^ sreg.v();
        break;

      case 0x6000: 	// ORI aka SBR	Logical AND with Immediate	0110 kkkk dddd kkkk
        //[r, k];
        var kr = this.getKr16(opcode);
        var r = kr[0];
        var k = kr[1];

        var res = memData[r] | k;

        if(debug) log("ORI r" + r + ", 0x" + k.toString(16));

        this.setReg(r, res);

        sreg.Z = res == 0;
        sreg.N = (res >> 7) & 1;
        sreg.V = 0;
        sreg.S = sreg.n() ^ sreg.v();

        break;

      case 0x7000: 	// ANDI	Logical AND with Immediate	0111 kkkk dddd kkkk
        this.notImplemented("ANDI");
        break;

      case 0xa000:
      case 0x8000:

        switch (opcode & 0xd008) {
          case 0xa000:
          case 0x8000: 	// LD (LDD) – Load Indirect using Z 10q0 qq0r rrrr 0qqq

            var v = memProg[RZ_L] | (memProg[RZ_H] << 8);
            var r = (opcode >> 4) & 0x1f;
            var q = ((opcode & 0x2000) >> 8) | ((opcode & 0x0c00) >> 7) | (opcode & 0x7);

            if (opcode & 0x0200) {
              if(debug) log("ST Z, r" + r);
              memData[v+q] = memData[r];
            } else {
              if(debug) log("LD r"+ r +", Z", v+q);
              memData[r] = memData[v+q];
            }
            cycle += 1; // 2 cycles, 3 for tinyavr
            break;
          case 0xa008:
          case 0x8008:	// LD (LDD) – Load Indirect using Y 10q0 qq0r rrrr 1qqq
            this.notImplemented("LD y");
            break;
          default:
            this.invalidOpcode(opcode);
        }

        break;

      case 0x9000:


        /* this is an annoying special case, but at least these lines handle all the SREG set/clear opcodes */
        if ((opcode & 0xff0f) == 0x9408) {


          var b = (opcode >> 4) & 7;
          var clse = opcode & 0x0080;
          if(debug) log((clse ? "cl" : "se") + sreg.nameFromBit(b).toLowerCase());

          sreg.setFromBit(b, clse == 0);

        } else switch (opcode) {

          case 0x9588: // SLEEP
            this.notImplemented("SLEEP");
            break;

          case 0x9598:  // BREAK
            this.notImplemented("BREAK");
            break;

          case 0x95a8:  // WDR
            this.notImplemented("WDR");
            break;

          case 0x95e8:  // SPM
            this.notImplemented("SPM");
            break;

          case 0x9409:   // IJMP Indirect jump 					1001 0100 0000 1001
          case 0x9419:   // EIJMP Indirect jump 					1001 0100 0001 1001   bit 4 is "indirect"
          case 0x9509:   // ICALL Indirect Call to Subroutine		1001 0101 0000 1001
          case 0x9519:   // EICALL Indirect Call to Subroutine	1001 0101 0001 1001   bit 8 is "push pc"
            this.notImplemented("IEJMPCALL");
            break;

          case 0x9518: 	// RETI
          case 0x9508:	// RET


            var ra = memData[++this.SP];
            var rb = memData[++this.SP];

            var sp = (rb << 8) | (ra << 0);

            if(debug) log("RET -> SP 0x" +sp.toString(16));
            new_pc = sp;

            if (opcode & 0x10)	{
              if(debug) log("RETI");
              sreg.I = 1;

              cycle += 3;
            }
            break;

          case 0x95c8:	// LPM Load Program Memory R0 <- (Z)
            this.notImplemented("LPM");
            break;

          case 0x9408:
          case 0x9418:
          case 0x9428:
          case 0x9438:
          case 0x9448:
          case 0x9458:
          case 0x9468:
          case 0x9478:
            // BSET 1001 0100 0ddd 1000
            this.notImplemented("BSET");
            break;

          case 0x9488:case 0x9498:case 0x94a8:case 0x94b8:case 0x94c8:case 0x94d8:case 0x94e8:
          case 0x94f8:	// bit 7 is 'clear vs set'
            // BCLR 1001 0100 1ddd 1000
            this.notImplemented("BCLR");
            break;

          default:

            switch (opcode & 0xfe0f) {
              case 0x9000:	// LDS Load Direct from Data Space, 32 bits
                var r = (opcode >> 4) & 0x1f;
                var x = (memProg[new_pc+1] << 8) | memProg[new_pc];

                new_pc += 2;
                if(debug) log("LDS r" + r + ", 0x" + x.toString(16));
                this.setReg(r, memData[x]);
                cycle++; // 2 cycles
                break;
              case 0x9005:
              case 0x9004: 	// LPM Load Program Memory 1001 000d dddd 01oo
                var z = memData[RZ_L] | (memData[RZ_H] << 8);
                var r = (opcode >> 4) & 0x1f;
                var op = opcode & 3;

                if(debug) log("LPM r" + r + ", Z" + (op?"+":""));

                this.setReg(r, memData[z]);

                if(op == 1) {
                  z++;
                  this.setReg(RZ_H, z >> 8);
                  this.setReg(RZ_L, z);
                }
                cycle += 2;
                break;
              case 0x9006:
              case 0x9007: 	// ELPM Extended Load Program Memory 1001 000d dddd 01oo
                this.notImplemented("ELPM");
                break;
              /*
               * Load store instructions
               *
               * 1001 00sr rrrr iioo
               * s = 0 = load, 1 = store
               * ii = 16 bits register index, 11 = Z, 10 = Y, 00 = X
               * oo = 1) post increment, 2) pre-decrement
               */
              case 0x900c:
              case 0x900d:
              case 0x900e: 	// LD Load Indirect from Data using X 1001 000r rrrr 11oo
                this.notImplemented("LD x");
                break;
              case 0x920c:
              case 0x920d:
              case 0x920e: 	// ST Store Indirect Data Space X 1001 001r rrrr 11oo
                var op = opcode & 3;
                var r = (opcode >> 4) & 0x1f;
                var x = (memData[RX_H] << 8) | memData[RX_L];

                if(debug) log("ST " + ( op == 2 ? "-" : "") + "X(0x" + x.toString(16) + ")" + ( op == 1 ? "+" : "") + " r" +r );

                cycle++;

                if(op == 2) x--;

                memData[x] = memData[r];

                if(op == 1) x++;
                this.setReg(RX_H, x >> 8);
                this.setReg(RX_L, x);

                break;
              case 0x9009:
              case 0x900a: 	// LD Load Indirect from Data using Y 1001 000r rrrr 10oo
                this.notImplemented("LD y");
                break;
              case 0x9209:
              case 0x920a: // ST Store Indirect Data Space Y 1001 001r rrrr 10oo
                this.notImplemented("ST y");
                break;
              case 0x9200: 	// STS ! Store Direct to Data Space, 32 bits
                var r = (opcode >> 4) & 0x1f;
                var x = (memProg[new_pc+1] << 8) | memProg[new_pc];
                new_pc += 2;
                if(debug) log("STS 0x" + x.toString(16) + ", r" +r);
                cycle++;
                memData[x] = memData[r];
                break;
              case 0x9001:
              case 0x9002: 	// LD Load Indirect from Data using Z 1001 001r rrrr 00oo
                this.notImplemented("LD z");
                break;
              case 0x9201:
              case 0x9202: // ST Store Indirect Data Space Z 1001 001r rrrr 00oo
                this.notImplemented("ST z");
                break;
              case 0x900f: 	// POP 1001 000d dddd 1111
                var rd=(opcode>>4)&0x1F;

                if(debug) log('POP r' + rd);

                var rc = memData[++this.SP];
                memData[rd] = rc;
                cycle++;
                break;
              case 0x920f: 	// PUSH 1001 001d dddd 1111
                var rd=(opcode>>4)&0x1F;
                if(debug) log('PUSH r' + rd);

                var rc = memData[rd];

                memData[this.SP--] = rc;

                cycle++;

                break;
              case 0x9400:	// COM – One’s Complement
                this.notImplemented("COM");
                break;
              case 0x9401: 	// NEG – Two’s Complement
                this.notImplemented("NEG");
                break;
              case 0x9402:	// SWAP – Swap Nibbles
                this.notImplemented("SWAP");
                break;
              case 0x9403: // INC – Increment
                this.notImplemented("INC");
                break;
              case 0x9405: 	// ASR – Arithmetic Shift Right 1001 010d dddd 0101
                this.notImplemented("ASR");
                break;
              case 0x9406: // LSR 1001 010d dddd 0110
                this.notImplemented("LSR");
                break;
              case 0x9407: 	// ROR 1001 010d dddd 0111
                this.notImplemented("ROR");
                break;
              case 0x940a: // DEC – Decrement
                var r = (opcode >> 4) & 0x1f;
                var res = memData[r] - 1;

                if(debug) log("DEC r" + r);

                this.setReg(r, res);

                sreg.Z = res == 0;
                sreg.N = res >> 7;
                sreg.V = res == 0x80;
                sreg.S = sreg.n() ^ sreg.v();
                break;
              case 0x940c:
              case 0x940d: 	// JMP Long Call to sub, 32 bits

                var a = ((opcode & 0x01f0) >> 3) | (opcode & 1);
                var x = (memProg[new_pc+1] <<8) | memProg[new_pc];

                a = (a << 16) | x;

                if(debug) log("JMP 0x" + a);

                new_pc = a << 1;
                cycle +=2;
                break;
              case 0x940e:
              case 0x940f: 	// CALL Long Call to sub, 32 bits
                var a = ((opcode & 0x01f0) >> 3) | (opcode & 1);
                var x = (memProg[new_pc+1] << 8) | memProg[new_pc];
                a = (a << 16) | x;

                if(debug) log('CALL 0x' + a.toString(16));

                new_pc += 2;
                memData[this.SP--] = (new_pc >> 8)&0xFF;
                memData[this.SP--] = (new_pc >> 0)&0xFF;

                new_pc = a << 1;
                cycle +=3;

                break;

              default:

                switch (opcode & 0xff00) {
                  case 0x9600: 	// ADIW - Add Immediate to Word 1001 0110 KKdd KKKK
                    this.notImplemented("ADIW");
                    break;
                  case 0x9700: // SBIW - Subtract Immediate from Word 1001 0110 KKdd KKKK
                    this.notImplemented("SBIW");
                    break;
                  case 0x9800: 	// CBI - Clear Bit in I/O Register 1001 1000 AAAA Abbb
                    var io = ((opcode >> 3) & 0x1f) + 32;
                    var b = opcode & 0x7;
                    var res = memData[io] & ~(1 << b);
                    if(debug) log("cbi r" + io + ", " + 1<<b);
                    memData[io] = res;
                    cycle++;
                    break;
                  case 0x9900:	// SBIC - Skip if Bit in I/O Register is Cleared 1001 0111 AAAA Abbb
                    this.notImplemented("SBIC");
                    break;
                  case 0x9a00: 	// SBI - Set Bit in I/O Register 1001 1000 AAAA Abbb
                    var io = ((opcode >> 3) & 0x1f) + 32;
                    var b = opcode & 0x7;
                    var res = memData[io] | (1 << b);
                    if(debug) log("sbi r" + io +", " + 1<<b);
                    memData[io] = res;
                    break;
                  case 0x9b00: 	// SBIS - Skip if Bit in I/O Register is Set 1001 1011 AAAA Abbb
                    var io = ((opcode >> 3) & 0x1f) + 32;
                    var b = opcode & 0x7;
                    var res = memData[io] & (1 << b);
                    if(debug) log("SBIS " + io + " will" + (res?"":" not") +" branch");
                    if (res) {
                      if (this.is32bit(new_pc)) {
                        new_pc += 4; cycle += 2;
                      } else {
                        new_pc += 2; cycle++;
                      }
                    }
                    break;

                  default:

                    switch (opcode & 0xfc00) {
                      case 0x9c00: 	// MUL - Multiply Unsigned 1001 11rd dddd rrrr
                        this.notImplemented("MUL");
                        break;
                      default:
                        this.invalidOpcode(opcode);
                    }
                }
            }

            break;
        }

        break;


      case 0xb000:

        switch (opcode & 0xf800) {
          case 0xb800: 	// OUT A,Rr 1011 1AAr rrrr AAAA
            var r = (opcode >> 4) & 0x1f;
            var A = ((((opcode >> 9) & 3) << 4) | ((opcode) & 0xf)) + 32;
            if(debug) log("OUT 0x"+ (A-32).toString(16) +", r" + r);
            memData[A] = memData[r];
            break;
          case 0xb000: 	// IN Rd,A 1011 0AAr rrrr AAAA
            var r = (opcode >> 4) & 0x1f;
            var A = ((((opcode >> 9) & 3) << 4) | ((opcode) & 0xf)) + 32;
            if(debug) log("IN r" + r  + ", 0x"+ (A-32).toString(16) );
            this.setReg(r, memData[A]);
            break;
          default:
            this.invalidOpcode(opcode);
        }

        break;

      case 0xc000: // RJMP 1100 kkkk kkkk kkkk
        var rk = opcode & 0x0fff;

        if(rk&0x800) {
          rk = rk | ~0xfff
        }
        if(debug) log("RJMP ." + rk, (new_pc + (rk << 1)).toString(16));
        new_pc =  new_pc + (rk << 1);
        cycle++;

        break;

      case 0xd000:  // RCALL 1100 kkkk kkkk kkkk

        this.notImplemented("RCALL");

        break;

      case 0xe000: 	// LDI Rd, K 1110 KKKK RRRR KKKK -- aka SER (LDI r, 0xff)
        var d = 16 + ((opcode >> 4) & 0xf);
        var k = ((opcode & 0x0f00) >> 4) | (opcode & 0xf);
        if(debug) log("LDI r" + d + ", 0x" + k.toString(16));
        this.setReg(d, k);
        break;

      case 0xf000:
        switch (opcode & 0xfe00) {
          case 0xf000:
          case 0xf200:
          case 0xf400:
          case 0xf600: // All the SREG branches

            var o=((opcode>>3)&0x7F); // offset
            if(o&0x40) o|=~0x7F;

            var s = opcode & 7;
            var set = +((opcode & 0x0400) == 0); // this bit means BRXC otherwise BRXS
            var branch = +(sreg.valueFromBit(s) && set || !sreg.valueFromBit(s) && !set);

            var names = [
              ["brcc", "brne", "brpl", "brvc", null, "brhc", "brtc", "brid"],
              ["brcs", "breq", "brmi", "brvs", null, "brhs", "brts", "brie"]
            ];

            var pc =  new_pc + ( o << 1);

            if(names[set][s]) {
              if(debug) log(names[set][s],  pc.toString(16), "will" + (branch ? " ": " not ") + "branch,", sreg.nameFromBit(s) + " was " + sreg.valueFromBit(s));
            } else {
              if(debug) log(set ? "brbs" : "brbc", npc, "will " + (branch ? "": " not ") + "branch,", sreg.nameFromBit(s) + " was " + sreg.valueFromBit(s));
            }

            if(branch) {
              cycle++; //2 cycles on branch, 1 if not
              new_pc = pc;
            }


            break;


          case 0xf800:
          case 0xf900: 	// BLD – Bit Store from T into a Bit in Register 1111 100r rrrr 0bbb
            this.notImplemented("BLD");
            break;
          case 0xfa00:
          case 0xfb00:	// BST – Bit Store into T from bit in Register 1111 100r rrrr 0bbb
            this.notImplemented("BST")
            break;
          case 0xfc00:
          case 0xfe00: 	// SBRS/SBRC – Skip if Bit in Register is Set/Clear 1111 11sr rrrr 0bbb
            this.notImplemented("SBRS/SBRC");
            break;
          default:
            this.invalidOpcode(opcode);
        }
        break;

      default:
        this.invalidOpcode(opcode);
    }


    if(debug) log("done, -> 0x" + new_pc.toString(16));
    this.CYCLES += cycle;
    this.PC = new_pc;
    this.STEP++;

  }
};


//Go forth
fs.readFile('asmblink.txt', function(err, file) {
  var hex = ihex.parse(file);


  var p = new Processor();
  p.PC = 0;

  for(var i = 0; i < hex.data.length; i++) {
    p.memProg[i] = hex.data.readUInt8(i);
    p.PC++;
  }

  p.PC = 0;


  //console.if(debug) log(p.getProgMem().readFromPtr().toString(16));
  //ermah
  for(var i = 0; i < 1000; i++) {
    p.run();
  }

  console.log(p.memData[0x25]);
});
