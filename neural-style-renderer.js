var _ = require('underscore');
var async = require('async');
var childProcess = require('child_process');
var config = require('config');
var events = require('events');
var fs = require('fs');
var neuralStyleUtil = require('./neural-style-util');
var path = require('path');
var util = require('util');
var xml2js = require('xml2js');

var NUM_PROGRESS_IMAGES = 10;

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

exports.QUEUED = 'queued';
exports.RUNNING = 'running';
exports.DONE = 'done';
exports.FAILED = 'failed';

function getTaskStatus(task) {
  var status = {
    'id': task.id,
    'contentUrl': neuralStyleUtil.imagePathToUrl(task.contentPath),
    'styleUrl': neuralStyleUtil.imagePathToUrl(task.stylePath),
    'settings': task.settings,
    'state': task.state,
    'iter': task.iter,
    'outputUrls': [],
  };

  var outputPath = neuralStyleUtil.getImagePathPrefix(task.id, neuralStyleUtil.OUTPUT);
  var saveIterStep = task.settings.numIterations / NUM_PROGRESS_IMAGES;
  for (var i = saveIterStep; i < task.iter; i += saveIterStep) {
    status['outputUrls'].push(neuralStyleUtil.imagePathToUrl(outputPath + '_' + i + '.png'));
  }
  if (task.state == exports.DONE) {
    status['outputUrls'].push(neuralStyleUtil.imagePathToUrl(outputPath + '.png'));
  }

  return status;
}

function runTaskCallback(task) {
  task.callback(null, getTaskStatus(task));
}

function runRender(task, callback) {
  task.state = exports.RUNNING;
  runTaskCallback(task);

  var outputPath = neuralStyleUtil.getImagePathPrefix(task.id, neuralStyleUtil.OUTPUT);
  var printIterStep = task.settings.numIterations / 100;
  var saveIterStep = task.settings.numIterations / NUM_PROGRESS_IMAGES;
  var gpuIndex = gpuIndexes.shift();

  var params = [
    path.join(config.get('neuralStylePath'), 'neural_style.lua'),
    '-content_image', task.contentPath,
    '-style_image', task.stylePath,
    '-image_size', task.settings.imageSize,
    '-gpu', gpuIndex,
    '-num_iterations', task.settings.numIterations,
    '-content_weight', task.settings.contentWeight,
    '-style_weight', task.settings.styleWeight,
    '-tv_weight', task.settings.tvWeight,
    '-init', task.settings.init,
    '-content_layers', task.settings.contentLayers.join(','),
    '-style_layers', task.settings.styleLayers.join(','),
    '-style_scale', task.settings.styleScale,
    '-pooling', task.settings.pooling,
    '-output_image', outputPath + '.png',
    '-print_iter', printIterStep,
    '-save_iter', saveIterStep,
    '-backend', 'cudnn',
  ];
  if (task.settings.normalizeGradients) {
    params.push('-normalize_gradients');
  }

  util.log('Running neural_style for id ' + task.id + ' with params: ' + params);
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
    task.iter = getLatestIteration(stdout);
    if (task.iter > lastIter) {
      lastIter = task.iter;
      runTaskCallback(task);
    }
  });

  neuralStyle.on('exit', function(code) {
    gpuIndexes.push(gpuIndex);
    if (code != 0) {
      util.log('neural_style failed for id ' + task.id + ' with code ' + code + '\n' + neuralStyle.stderr.read());
      task.state = exports.FAILED;
    } else {
      util.log('neural_style done for id ' + task.id);
      task.state = exports.DONE;
    }
    runTaskCallback(task);
    sendStatusEvent();
    callback();
  });
}

var workqueue;
var tasks = [];
queryGpus(function(gpuInfo) {
  gpuIndexes = _.range(gpuInfo.attached_gpus[0]);
  workqueue = async.queue(runRender, gpuInfo.attached_gpus[0]);
});

var DEFAULT_SETTINGS = {
  'imageSize': 256,
  'numIterations': 1000,
  'contentWeight': 5,
  'styleWeight': 100,
  'tvWeight': 0.001,
  'init': 'random',
  'normalizeGradients': false,
  'contentLayers': ['relu4_2'],
  'styleLayers': ['relu1_1', 'relu2_1', 'relu3_1', 'relu4_1', 'relu5_1'],
  'styleScale': 1.0,
  'pooling': 'max',
};

function enqueueJob(id, settings, callback) {
  settings = _.defaults(settings, DEFAULT_SETTINGS);
  async.parallel([
    function(cb) {
      fs.writeFile(neuralStyleUtil.getSettingsPath(id), settings, cb);
    },
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
    var task = {
      'id': id,
      'state': exports.QUEUED,
      'callback': callback,
      'contentPath': results[1],
      'stylePath': results[2],
      'settings': settings,
      'iter': 0,
    };
    runTaskCallback(task);
    tasks.unshift(task);
    workqueue.push(task);
    sendStatusEvent();
  });
}
exports.enqueueJob = enqueueJob;

exports.getTaskStatuses = function() {
  return _.map(tasks, getTaskStatus);
}

exports.getStatus = function(callback) {
  queryGpus(function(gpuInfo) {
    var status = {
      'queuedTasks': workqueue.length(),
      'gpus': [],
    };
    _.each(gpuInfo.gpu, function(gpu) {
      status.gpus.push({
        'utilization': gpu.utilization[0].gpu_util[0],
        'temperature': gpu.temperature[0].gpu_temp[0],
        'power': gpu.power_readings[0].power_draw[0],
      });
    });
    callback(status);
  });
}

exports.statusEventEmitter = new events.EventEmitter();

function sendStatusEvent() {
  exports.getStatus(function(status) {
    exports.statusEventEmitter.emit('status', status);
  });
}
setInterval(sendStatusEvent, 15000);
