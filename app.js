var bodyParser = require('body-parser');
var config = require('config');
var express = require('express');
var fs = require('fs');
var morgan = require('morgan');
var path = require('path');

try {
  fs.mkdirSync(config.get('dataPath'));
} catch (ex) {
  if (ex.code != 'EEXIST') {
    throw ex;
  }
}

var app = express();
app.use(morgan('short'));

app.use(express.static('public'));
app.use('/bower_components', express.static(__dirname + '/bower_components'));

var rawBodyParser = bodyParser.raw({limit: '10mb'});
app.post('/upload/:id/:purpose', rawBodyParser, function(req, res) {
  var outputPath = path.join(
    config.get('dataPath'),
    req.params.id + '_' + req.params.purpose);
  fs.writeFile(outputPath, req.body, 'binary', function(err) {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.end();
  });
});

var server = app.listen(8000, function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});
