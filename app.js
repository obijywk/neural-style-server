var _ = require('underscore');
var async = require('async');
var bodyParser = require('body-parser');
var config = require('config');
var express = require('express');
var expressWs = require('express-ws');
var morgan = require('morgan');
var neuralStyleRenderer = require('./neural-style-renderer');
var neuralStyleUtil = require('./neural-style-util');

var app = express();
expressWs(app);
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

var server = app.listen(8000, function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});
