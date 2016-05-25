var _ = require('underscore');
var async = require('async');
var config = require('config');
var fs = require('fs');
var imagemagick = require('imagemagick');
var path = require('path');
var exec = require('child_process').exec;

try {
  fs.mkdirSync(config.get('dataPath'));
} catch (ex) {
  if (ex.code != 'EEXIST') {
    throw ex;
  }
}

exports.CONTENT = 'content';
exports.STYLE = 'style';
exports.OUTPUT = 'output';

exports.QUEUED = 'queued';
exports.RUNNING = 'running';
exports.DONE = 'done';
exports.FAILED = 'failed';
exports.CANCELLED = 'cancelled';

exports.getExistingTasks = function(callback) {
  fs.readdir(config.get('dataPath'), function(err, files) {
    if (err) return callback(err);
    var idToTask = {};
    var idToTimestamp = {};
    async.each(files, function(file, cb) {
      var ext = path.extname(file);
      var name = file.substring(0, file.length - ext.length);
      var nameParts = name.split('_');
      if (nameParts.length < 2) return cb(null);

      var id = nameParts[0];
      if (!exports.validateId(id)) return cb(null);

      if (!_.has(idToTask, id)) {
        idToTask[id] = {
          'id': id,
          'state': exports.FAILED,
        };
      }
      var task = idToTask[id];

      if (nameParts[1] == 'settings' && ext == '.json') {
        var filePath = path.join(config.get('dataPath'), file);
        fs.readFile(filePath, function(err, data) {
          if (err) return cb(err);
          task.settings = JSON.parse(data);
          task.iter = task.settings.numIterations;
          fs.stat(filePath, function(err, stats) {
            if (err) return cb(err);
            idToTimestamp[id] = stats.mtime.getTime();
            return cb(null);
          });
        });
      } else if (nameParts[1] == exports.OUTPUT && nameParts.length == 2) {
        task.state = exports.DONE;
        return cb(null);
      } else if (nameParts[1] == exports.CONTENT) {
        task.contentPath = path.join(config.get('dataPath'), file);
        return cb(null);
      } else if (nameParts[1] == exports.STYLE) {
        task.stylePath = path.join(config.get('dataPath'), file);
        return cb(null);
      } else {
        return cb(null);
      }
    }, function(err) {
      if (err) return callback(err);
      var tasks = _.chain(idToTask)
          .values()
          .filter(function(task) {
            return _.has(task, 'contentPath') && _.has(task, 'stylePath') && _.has(task, 'settings');
          })
          .sortBy(function(task) {
            return -idToTimestamp[task.id];
          })
          .value();
      callback(null, tasks);
    });
  });
}

exports.getSettingsPath = function(id) {
  return path.join(
    config.get('dataPath'),
    id + '_settings.json');
}

exports.getImagePathPrefix = function(id, purpose) {
  return path.join(
    config.get('dataPath'),
    id + '_' + purpose);
}

exports.saveImage = function(id, purpose, index, data, callback) {
  var outputPath = exports.getImagePathPrefix(id, purpose) + '_' + index;
  async.waterfall([
    function(cb) {
      fs.writeFile(outputPath, data, cb);
    },
    function(cb) {
      imagemagick.identify(outputPath, cb);
    },
    function(features, cb) {
      var outputPathWithExt;
      if (features['format'] == 'JPEG') {
        outputPathWithExt = outputPath + '.jpg';
      } else if (features['format'] == 'PNG') {
        outputPathWithExt = outputPath + '.png';
      }
      if (outputPathWithExt) {
        fs.rename(outputPath, outputPathWithExt, cb);
      } else {
        cb(null);
      }
    },
  ], callback);
}

exports.findImagePath = function(id, purpose, callback) {
  var fileNamePrefix = id + '_' + purpose;
  exec("find "+config.get('dataPath')+" -name '"+fileNamePrefix+"*'", function(error, stdout, stderr){
    var arr = stdout.split('\n');
    arr.pop();
    var str = arr.join(',');
    return callback(error, str);
  });
}

exports.imagePathToUrl = function(imagePath) {
  var filename = path.basename(imagePath);
  return path.join('/data', filename);
}

exports.validateId = function(id) {
  return /^\d+$/.exec(id);
}
