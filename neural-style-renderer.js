var _ = require('underscore');
var async = require('async');
var childProcess = require('child_process');
var config = require('config');
var neuralStyleUtil = require('./neural-style-util');
var path = require('path');
var util = require('util');
var xml2js = require('xml2js');

function queryGpus(callback) {
  var nvidiaSmi = childProcess.spawn(
    'nvidia-smi',
    ['-q', '-x']);
  nvidiaSmi.on('exit', function(code) {
    if (code != 0) {
      util.log('nvidia-smi failed with code ' + code);
      return callback({});
    }
    xml2js.parseString(nvidiaSmi.stdout.read(), function(err, data) {
      if (err) {
        util.log('failed to parse nvidia-smi output: ' + err);
        return callback({});
      }
      return callback(data.nvidia_smi_log);
    });
  });
}
exports.queryGpus = queryGpus;

var gpuIndexes = [];

exports.RUNNING = 'running';
exports.DONE = 'done';
exports.FAILED = 'failed';

function runRender(task, callback) {
  var outputPath = neuralStyleUtil.getImageBasePath(task.id, neuralStyleUtil.OUTPUT);

  var numIterations = 1000;
  var printIterStep = numIterations / 100;
  var saveIterStep = numIterations / 10;

  function makeStatus(iter) {
    var status = {
      'id': task.id,
      'contentPath': task.contentPath,
      'stylePath': task.stylePath,
      'iter': iter,
      'numIterations': numIterations,
      'state': exports.RUNNING,
    };
    if (iter == numIterations) {
      status['outputPath'] = outputPath + '.png';
      status['state'] = exports.DONE;
    } else if (iter >= saveIterStep) {
      status['outputPath'] = outputPath + '_' + (iter - (iter % saveIterStep)) + '.png';
    }
    return status;
  }

  var gpuIndex = gpuIndexes.shift();
  var params = [
    path.join(config.get('neuralStylePath'), 'neural_style.lua'),
    '-content_image', task.contentPath,
    '-style_image', task.stylePath,
    '-image_size', '256',
    '-gpu', gpuIndex,
    '-num_iterations', numIterations,
    '-output_image', outputPath + '.png',
    '-print_iter', printIterStep,
    '-save_iter', saveIterStep,
    '-backend', 'cudnn',
  ];

  var neuralStyle = childProcess.spawn('th', params, {
    'cwd': config.get('neuralStylePath'),
  });

  function getLatestIteration(stdout) {
    var iterRegex = /Iteration (\d+) \/ \d+/;
    var lines = stdout.split('\n');
    var i = lines.length - 1;
    while (i >= 0) {
      var match = iterRegex.exec(lines[i]);
      if (match) {
        return Number(match[1]);
      }
      i--;
    }
    return 0;
  }

  var stdout = '';
  var lastIter = 0;
  neuralStyle.stdout.on('data', function(data) {
    stdout += String(data);
    var iter = getLatestIteration(stdout);
    if (iter > lastIter) {
      lastIter = iter;
      var status = makeStatus(iter);
      task.callback(null, status);
    }
  });

  neuralStyle.on('exit', function(code) {
    gpuIndexes.push(gpuIndex);
    var status = makeStatus(lastIter);
    if (code != 0) {
      util.log('neural_style failed with code ' + code + '\n' + neuralStyle.stderr.read());
      status['state'] = exports.FAILED;
    }
    task.callback(null, status);
    callback();
  });
}

var workqueue;
queryGpus(function(gpuInfo) {
  gpuIndexes = _.range(gpuInfo.attached_gpus[0]);
  workqueue = async.queue(runRender, gpuInfo.attached_gpus[0]);
});

function enqueueJob(id, callback) {
  async.parallel([
    function(cb) {
      neuralStyleUtil.findImagePath(id, neuralStyleUtil.CONTENT, cb);
    },
    function(cb) {
      neuralStyleUtil.findImagePath(id, neuralStyleUtil.STYLE, cb);
    },
  ], function(err, results) {
    if (err) {
      callback(err);
      return;
    }
    workqueue.push({
      'id': id,
      'callback': callback,
      'contentPath': results[0],
      'stylePath': results[1],
    });
  });
}
exports.enqueueJob = enqueueJob;
