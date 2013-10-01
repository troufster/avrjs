



function AvrCtrl($scope, $http) {

  var p = new Processor();

  $scope.avr = p;

  $scope.memq = -1;

  $scope.searchMem = function() {
    $scope.memlook = p.memData[parseInt($scope.memq)];
  };
  p.PC = 0;

  $http({method: 'GET', url: '/avr'}).success(
    function(d) {
      for(var i = 0; i < d.data.length; i++) {

        p.memProg[p.PC++] = d.data[i];

      }

      p.PC = 0;

      //Dbg.log(p.getProgMem());
    }
  );


  $scope.regs = [];
  $scope.iomem = [];
  $scope.sreg = {};

  function refresh() {
    $scope.log = log;
    $scope.regs = [];
    $scope.iomem = [];


    for(var i = 0; i < 32; i++) {
      $scope.regs.push({ id : i, val : p.memData[i].toString(16)});
    }


    for(var i = 0x0020; i <= 0x005f; i++) {
      $scope.iomem.push({ id : "0x"+i.toString(16), val : p.memData[i].toString(16) + "(" + p.memData[i].toString(2) + ")"});
    }




  }

  $scope.reset = function() {
    p.reset();
    log=[];
    $scope.log = log;
    refresh();
  };

  $scope.step = function() {
    p.run();
    $scope.STEP = p.STEP;
    refresh();
  };
  $scope.halt = false;

  $scope.runto = 140;

  $scope.run = function() {
    var i = $scope.runto; //blinkp.hex 140 pinmode + digital write returning too soon :((

    while(i--) {
      p.run();
      $scope.STEP = p.STEP;
    }

    refresh();

  }








}