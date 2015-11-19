var express = require('express');
var morgan = require('morgan');
var app = express();

app.use(morgan('short'));

app.use(express.static('public'));
app.use('/bower_components', express.static(__dirname + '/bower_components'));

var server = app.listen(8000, function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});
