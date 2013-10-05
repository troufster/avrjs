"use strict";

var assert = require('assert');
var fs = require('fs');
var ihex = require('intel-hex');
var Processor = require('../static/avr.js');

function getp() { return new Processor();}

function loadsingleinstr(p, hexarray) {
  p.PC = 0;

  for(var i = 0; i < hexarray.length; i++) {
    p.memProg[p.PC++] = hexarray[i];
  }
  p.PC = 0;
}

function load(p, cb) {
  fs.readFile('./test/fixture/asmblink.txt', function(err, file) {
    p.PC = 0;

    if(err) throw err;

    var hex = ihex.parse(file);

    for(var i = 0; i < hex.data.length; i++) {
      p.memProg[p.PC++] = hex.data.readUInt8(i);
    }

    p.PC = 0;

    cb(null, p);
  });
}

function compareCarry(rd,k,r, b) {
  var rdb = rd >> b;
  var kb = k >> b;
  var rb = r >> b;

  var result = (~rdb & kb ) | (kb & rb) | (rb & ~rdb);

  return result & 0x1;
}

function compareOflow(rd, k,r,b) {
  var rdb = rd >> b;
  var kb = k >> b;
  var rb = r >> b;

  var result = (rdb & ~kb & ~rb) | (~rdb & kb & rb);

  return result;
}

describe('Basic functions', function(){
  var p = getp();

  it('should be instancing processor', function(done){

    p.should.not.equal(null);
    done();
  });

  it('should set PC, CYCLES, STEP to 0', function(done) {

    p.PC.should.equal(0);
    p.CYCLES.should.equal(0);
    p.STEP.should.equal(0);

    done();
  });

  it('should set SP -> 0xffff', function(done) {
    p.SP.should.equal(0xffff);

    done();
  });

  it('should load program', function(done) {

      load(p, function(e, pp) {
        p.memProg[p.PC].should.equal(0x0c);
        p.memProg[p.PC+1].should.equal(0x94);


        done();
      });

  });

});

describe('Instructions', function() {
  describe('jmp', function() {
    it("should move PC properly", function(done) {
        var p = getp();

        //jmp 0x68
        loadsingleinstr(p, [0x0c, 0x94, 0x34, 0x00]);

        p.run();

        p.PC.should.equal(0x68);

        done();
    });

  });
  describe('rjmp', function() {
    it("should move PC properly", function(done) {
      var p = getp();

      //rjmp .+4
      loadsingleinstr(p, [0x02, 0xc0]);

      p.run();

      //Size of instruction + value of rjmp
      p.PC.should.equal(0x02 + 0x04);

      done();
    });

  });
  describe('eor', function() {
    //eor r1, r2;
    var instruction = [0x12, 0x24];
    it("should set result of XOR-operation to rd, eor r1,r2", function(done) {

      var r1 = 0xff;
      var r2 = 0xfe;

      var p = getp();
      loadsingleinstr(p, instruction);
      p.setReg(1, r1);
      p.setReg(2, r2);

      p.run();

      p.memData[1].should.equal(1);

      //reset PC

      p.PC = 0;

      r1 = 0xf0;
      r2 = 0x0f;

      p.setReg(1, r1);
      p.setReg(2, r2);

      p.run();

      p.memData[1].should.equal(0xff);
      done();
    });
    it("should set sreg Z if zero", function(done) {
      var r1 = 0x00;
      var r2 = 0x00;

      var p = getp();
      loadsingleinstr(p, instruction);

      p.setReg(1, r1);
      p.setReg(2, r2);

      p.run();

      p.memData[1].should.equal(0x00);
      p.sreg.z().should.equal(1);

      done();
    });
  });
  describe('out', function() {
    //out 0x3f, r1
    var instruction = [0x1f, 0xbe];
    it("should set I/O-memory to value of register", function(done) {
      var p = getp();
      var v = 0xfe;
      loadsingleinstr(p, instruction);
      p.setReg(1, v);

      p.run();

      p.memData[0x3f + 0x20].should.equal(v);

      done();
    });

  });
  describe('ldi', function() {
    //ldi r28, 0xff
    var instruction = [0xcf, 0xef];
    it("should set register to immediate value", function(done) {
      var p = getp();
      loadsingleinstr(p, instruction);
      p.run();

      p.memData[28].should.equal(0xff);

      done();
    });
  });
  describe('cpi', function() {
    //cpi r26, 0x00
    var instruction = [0xa0, 0x30];

    it("should set sreg properly on values r == k", function(done) {
      var p = getp();
      loadsingleinstr(p, instruction);

      p.memData[26] = 0x00;
      var r26 = p.memData[26];
      p.run();


      var hval = compareCarry(r26, 0x00, 0, 3);
      var cval = compareCarry(r26, 0x00, 0, 7);
      var vval = compareOflow(r26, 0x00, 0, 7);

      //MSB of 0
      var nval = (0 >> 7) & 1;

      p.sreg.z().should.equal(1);
      p.sreg.h().should.equal(hval);
      p.sreg.c().should.equal(cval);
      p.sreg.n().should.equal(nval);
      p.sreg.v().should.equal(vval);
      p.sreg.s().should.equal(p.sreg.n() ^ p.sreg.v());

      done();
    });

    it("should set sreg properly on values r > k", function(done) {
      var p = getp();
      loadsingleinstr(p, instruction);

      var val = 0xff;
      p.memData[26] = val;
      var r26 = p.memData[26];
      p.run();

      var resval = r26 - 0x00;

      var hval = compareCarry(r26, 0x00, resval, 3);
      var cval = compareCarry(r26, 0x00, resval, 7);
      var vval = compareOflow(r26, 0x00, resval, 7);

      //MSB of 0
      var nval = (resval >> 7) & 1;

      p.sreg.z().should.equal(0);
      p.sreg.h().should.equal(hval);
      p.sreg.c().should.equal(cval);
      p.sreg.n().should.equal(nval);
      p.sreg.v().should.equal(vval);
      p.sreg.s().should.equal(p.sreg.n() ^ p.sreg.v());

      done();
    });

    it("should set sreg properly on values r < k", function(done) {
      //cpi r26, 0xff
      instruction = [0xaf, 0x3f];


      var p = getp();
      loadsingleinstr(p, instruction);

      var rval = 0x00;
      var kval = 0xff;
      p.memData[26] = rval;
      var r26 = p.memData[26];
      p.run();

      var resval = r26 - kval;

      var hval = compareCarry(r26, kval, resval, 3);
      var cval = compareCarry(r26, kval, resval, 7);
      var vval = compareOflow(r26, kval, resval, 7);

      //MSB of 0
      var nval = (resval >> 7) & 1;

      p.sreg.z().should.equal(0);
      p.sreg.h().should.equal(hval);
      p.sreg.c().should.equal(cval);
      p.sreg.n().should.equal(nval);
      p.sreg.v().should.equal(vval);
      p.sreg.s().should.equal(p.sreg.n() ^ p.sreg.v());

      done();
    });
  });

  
});