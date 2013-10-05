express = require('express');


var ihex = require('intel-hex');
var fs = require('fs');

var app = express();

app.configure(function() {
  app.use('/', express.static('./static'));
});


app.get('/avr', function(req,res){
  fs.readFile('asmblink.txt', function(err, file) {
    var hex = ihex.parse(file);

    res.send(hex);
  });
});

app.listen(3000);
