# neural-style-server
A web server frontend for https://github.com/jcjohnson/neural-style

## Setup
**Dependencies**:
* [jcjohnson/neural-style](https://github.com/jcjohnson/neural-style)
* nodejs (tested with v0.10.25)

Follow the [neural-style setup instructions](https://github.com/jcjohnson/neural-style/blob/master/INSTALL.md) for installing neural-style and all of its dependencies. neural-style-server assumes that neural-style is being used with NVidia hardware, CUDA, and CuDNN (e.g. it depends on nvidia-smi for enumerating GPUs).

Once you have neural-style set up, clone the neural-style-server repository. You'll need to edit [config/default.json](https://github.com/obijywk/neural-style-server/blob/master/config/default.json) or add your own config file e.g. config/local.json - see the [node-config documentation](https://github.com/lorenwest/node-config/wiki/Configuration-Files) for more information about config file naming and load order.

**Config options:**
* `port`: (required) The HTTP server port on which the web server will listen.
* `dataPath`: (required) The directory where image and settings input files and image output files will be stored. There shouldn't be any other files in this directory - neural-style-server will scan it on startup to discover data created by previous runs.
* `neuralStylePath`: (requierd) The directory where the [neural-style](https://github.com/jcjohnson/neural-style) repository is cloned.
* `username`: (optional) A username to use for HTTP basic auth. May be omitted to disable auth.
* `password`: (optional) A password to use for HTTP basic auth. May be omitted to disable auth. 

## Run
You must run neural-style-server from a shell that has environment variables configured to use Torch (if you did not allow the Torch installer to configure this by default, you can run `source install/bin/torch-activate` from the Torch directory to set up the necessary environment).

To launch neural-style-server, run:
```
nodejs app.js
```

## Screenshot
<img src="https://raw.githubusercontent.com/obijywk/neural-style-server/master/screenshots/screenshot.png">
