var _ = require('underscore');
var async = require('async');
var bodyParser = require('body-parser');
var config = require('config');
var express = require('express');
var expressWs = require('express-ws');
var morgan = require('morgan');
var neuralStyleRenderer = require('./neural-style-renderer');
var neuralStyleUtil = require('./neural-style-util');
var passport = require('passport');
var passportHttp = require('passport-http');

var app = express();
expressWs(app);
app.use(morgan('short'));

if (config.has('username') && config.has('password')) {
  passport.use(new passportHttp.BasicStrategy(
    function(username, password, callback) {
      if (username != config.get('username') || password != config.get('password')) {
        callback(null, false);
      }
      callback(null, {});
    }));
  app.use(passport.authenticate('basic', {session: false}));
}

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

var jsonBodyParser = bodyParser.json();
app.post('/render/:id', jsonBodyParser, function(req, res) {
  if (!neuralStyleUtil.validateId(req.params.id)) {
    res.status(400).send('invalid id');
    return;
  }
  var settings = req.body;
  neuralStyleRenderer.enqueueJob(req.params.id, settings, function(err, status) {
    if (err) {
      console.log(err);
      return;
    }
    broadcastUpdate('render', status);
  });
  res.end();
});

var updateSockets = [];
app.ws('/updates', function(ws, req) {
  updateSockets.push(ws);
  ws.on('close', function() {
    var index = updateSockets.indexOf(ws);
    updateSockets.splice(index, 1);
  });
  neuralStyleRenderer.getStatus(function(status) {
    if (_.findIndex(updateSockets, ws) == -1) {
      return;
    }
    ws.send(JSON.stringify({'type': 'status', 'data': status}));
  });
  process.nextTick(function() {
    if (_.findIndex(updateSockets, ws) == -1) {
      return;
    }
    var taskStatuses = neuralStyleRenderer.getTaskStatuses();
    for (var i = taskStatuses.length - 1; i >= 0; i--) {
      ws.send(JSON.stringify({'type': 'render', 'data': taskStatuses[i]}));
    }
  });
});

function broadcastUpdate(type, data) {
  _.each(updateSockets, function(ws) {
    ws.send(JSON.stringify({'type': type, 'data': data}));
  });
}

neuralStyleRenderer.statusEventEmitter.on('status', function(status) {
  broadcastUpdate('status', status);
});

var server = app.listen(config.get('port'), function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});
