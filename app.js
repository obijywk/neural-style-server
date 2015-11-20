var async = require('async');
var bodyParser = require('body-parser');
var config = require('config');
var express = require('express');
var morgan = require('morgan');
var neuralStyleRenderer = require('./neural-style-renderer');
var neuralStyleUtil = require('./neural-style-util');

var app = express();
app.use(morgan('short'));

app.use(express.static('public'));
app.use('/bower_components', express.static(__dirname + '/bower_components'));
app.use('/data', express.static(config.get('dataPath')));

var rawBodyParser = bodyParser.raw({limit: '10mb'});
app.post('/upload/:id/:purpose', rawBodyParser, function(req, res) {
  if (!neuralStyleUtil.validateId(req.params.id)) {
    res.status(400).send('invalid id');
    return;
  }
  neuralStyleUtil.saveImage(req.params.id, req.params.purpose, req.body, function(err) {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.end();
  });
});

app.post('/render/:id', function(req, res) {
  if (!neuralStyleUtil.validateId(req.params.id)) {
    res.status(400).send('invalid id');
    return;
  }
  neuralStyleRenderer.enqueueJob(req.params.id, function(err, status) {
    if (err) {
      console.log(err);
    }
    console.log(status);
  });
  res.end();
});

var server = app.listen(8000, function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});
