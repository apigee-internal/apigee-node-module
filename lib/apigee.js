global.request=require("./apigeeRequest");
require("./usergrid");
require("./monitoring");
(function() {
  var name = 'Apigee',
    global = this,
    overwrittenName = global[name];
  if (!Usergrid) {
    throw "Usergrid module is required."
  }
  if (!Usergrid.client.prototype.logAssert) {
    throw "Usergrid monitoring extensions are not present."
  }


  var VERBS = {
    get: "GET",
    post: "POST",
    put: "PUT",
    del: "DELETE",
    head: "HEAD"
  };

  var MONITORING_SDKVERSION = "0.0.1";

  var LOGLEVELS = {
    verbose: "V",
    debug: "D",
    info: "I",
    warn: "W",
    error: "E",
    assert: "A"
  };

  var LOGLEVELNUMBERS = {
    verbose: 2,
    debug: 3,
    info: 4,
    warn: 5,
    error: 6,
    assert: 7
  };

  var UNKNOWN = "UNKNOWN";

  var SDKTYPE = "JavaScript";
  //Work around hack because onerror is always called in the window context so we can't store crashes internally
  //This isn't too bad because we are encapsulated.
  var logs = [];
  var metrics = [];
  var Apigee = Usergrid;
  Apigee.prototype = Usergrid.prototype;
  //Apigee.constructor=Apigee;
  //function Apigee() {};
  Apigee.Client = function(options, callback) {
    //Init app monitoring.
    var self = this;
    Usergrid.client.call(self, options, function() {
      self.monitoringEnabled = options.monitoringEnabled || true;
      if (self.monitoringEnabled) {
        try {
          var monitor = new Apigee.MonitoringClient(options, function() {
            self.monitor = this;
            if ("function" === typeof callback) {
              callback.call(self);
            }
          });
        } catch (e) {
          console.log(e);
        }
      } else if ("function" === typeof callback) {
        callback.call(self);
      }
    });
  }
  Apigee.Client.prototype = Usergrid.client.prototype;
  //Apigee.Client.constructor=Apigee.Client;
  //BEGIN APIGEE MONITORING SDK

  //Constructor for Apigee Monitoring SDK
  Apigee.MonitoringClient = function(options, callback) {
    //Needed for the setInterval call for syncing. Have to pass in a ref to ourselves. It blows scope away.
    var self = this;
    self.orgName = options.orgName;
    self.appName = options.appName;
    self.syncOnClose = options.syncOnClose || false;

    //Put this in here because I don't want sync issues with testing.
    self.testMode = options.testMode || false;
    //You best know what you're doing if you're setting this for Apigee monitoring!
    self.URI = typeof options.URI === "undefined" ? "https://api.usergrid.com" : options.URI;

    self.syncDate = timeStamp();

    function _callback(err, data) {
      //console.log(data);
      self.configuration = data;
      //Don't do anything if configuration wasn't loaded.
      if ((self.configuration !== null) && (self.configuration !== "undefined")) {

        if (self.configuration.deviceLevelOverrideEnabled === true) {
          self.deviceConfig = self.configuration.deviceLevelAppConfig;
        } else if (self.abtestingOverrideEnabled === true) {
          self.deviceConfig = self.configuration.abtestingAppConfig;
        } else {
          self.deviceConfig = self.configuration.defaultAppConfig;
        }
        //Ensure that we want to sample data from this device.
        var sampleSeed = 0;
        if (self.deviceConfig.samplingRate < 100) {
          sampleSeed = Math.floor(Math.random() * 101)
        }

        //If we're not in the sampling window don't setup data collection at all
        if (sampleSeed < self.deviceConfig.samplingRate) {
          self.appId = self.configuration.instaOpsApplicationId;
          self.appConfigType = self.deviceConfig.appConfigType;

          //Let's monkeypatch logging calls to intercept and send to server.
          if (self.deviceConfig.enableLogMonitoring) {
            self.patchLoggingCalls();
          }

          var syncIntervalMillis = 3000;
          if (typeof self.deviceConfig.agentUploadIntervalInSeconds !== "undefined") {
            syncIntervalMillis = self.deviceConfig.agentUploadIntervalInSeconds * 1000;
          }

          //Needed for the setInterval call for syncing. Have to pass in a ref to ourselves. It blows scope away.
          if (!self.syncOnClose) {
            //Old server syncing logic
            setInterval(function() {
              self.prepareSync();
            }, syncIntervalMillis);
          } else {
            //TODO verify this
            process.on("exit", function(e) {
              self.prepareSync();
            });
          }


          //Setting up the catching of errors and network calls
          if ("undefined" !== typeof XMLHttpRequest && self.deviceConfig.networkMonitoringEnabled) {
            self.patchNetworkCalls(XMLHttpRequest);
          }

          //window.onerror = Apigee.MonitoringClient.catchCrashReport;
          self.startSession();
          self.sync({});
          process.on('uncaughtException', function(err) {
            Apigee.MonitoringClient.catchCrashReport.call(self, err);
            //setTimeout(function(){
            self.prepareSync(function() {
              console.error("Uncaught exception: ", err);
              process.exit(1);
            });
            //}, syncIntervalMillis+1)
          });
        }
      } else {
        console.log("Error: Apigee APM configuration unavailable.");
      }
      process.nextTick(function() {
        //console.log("CONFIG", self.configuration);
        //console.log("DEVICE CONFIG", self.deviceConfig);
        ("function" === typeof callback) && callback.apply(self);
      })
    }

    //Can do a manual config override specifiying raw json as your config. I use this for testing.
    //May be useful down the road. Needs to conform to current config.
    if (typeof options.config !== "undefined") {
      self.configuration = options.config;
      _callback();
    } else {
      self.configuration = null;
      self.downloadConfig(_callback);
    }
  };

  Apigee.MonitoringClient.prototype.applyMonkeyPatches = function() {
    var self = this;
    //Let's monkeypatch logging calls to intercept and send to server.
    if (self.deviceConfig.enableLogMonitoring) {
      self.patchLoggingCalls();
    }
    //Setting up the catching of errors and network calls
    if ("undefined" !== typeof XMLHttpRequest && self.deviceConfig.networkMonitoringEnabled) {
      self.patchNetworkCalls(XMLHttpRequest);
    }
  }
  /**
   * Function for downloading the current Apigee Monitoring configuration.
   *
   * @method downloadConfig
   * @public
   * @params {function} callback
   * NOTE: Passing in a callback makes this call async. Wires it all up for you.
   *
   */
  Apigee.MonitoringClient.prototype.downloadConfig = function(callback) {
    var self = this;
    var configRequest = require('request');
    var method = VERBS.get;
    var path = this.URI + '/' + this.orgName + '/' + this.appName + '/apm/apigeeMobileConfig';
    var callOptions = {
      method: method,
      uri: path,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      }
    };
    configRequest(callOptions, function(err, r, data) {
      //console.log("RESPONSE", err, JSON.parse(data));
      if (err) {
        console.error("An error occurred while retrieving the app configuration", err);
        if (typeof callback === "function") {
          callback(err);
        }
      } else {
        var config = JSON.parse(data);
        if (typeof callback === "function") {
          callback(err, config);
        } else {
          self.configuration = config;
          if (config.deviceLevelOverrideEnabled === true) {
            self.deviceConfig = config.deviceLevelAppConfig;
          } else if (self.abtestingOverrideEnabled === true) {
            self.deviceConfig = config.abtestingAppConfig;
          } else {
            self.deviceConfig = config.defaultAppConfig;
          }
          self.prepareSync();
          callback(err, config);
        }
      }
    });
  };


  /**
   * Function for syncing data back to the server. Currently called in the Apigee.MonitoringClient constructor using setInterval.
   *
   * @method sync
   * @public
   * @params {object} syncObject
   *
   */
  Apigee.MonitoringClient.prototype.sync = function(syncObject, callback) {
    //Sterilize the sync data
    //console.log("SYNC");
    var syncData = {}
    syncData.logs = syncObject.logs;
    syncData.metrics = syncObject.metrics;
    syncData.sessionMetrics = this.sessionMetrics;
    syncData.orgName = this.orgName;
    syncData.appName = this.appName;
    syncData.fullAppName = this.orgName + '_' + this.appName;
    syncData.instaOpsApplicationId = this.configuration.instaOpsApplicationId;
    syncData.timeStamp = timeStamp();

    //Send it to the apmMetrics endpoint.
    var self = this;
    var syncRequest = global.request;
    var method = VERBS.post;
    var path = this.URI + '/' + this.orgName + '/' + this.appName + '/apm/apmMetrics';
    var callOptions = {
      method: method,
      uri: path,
      json: syncData,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      }
    };

    syncRequest(callOptions, function(err, r, data) {
      //Only wipe data if the sync was good. Hold onto it if it was bad.
      if (err) {
        //Not much we can do if there was an error syncing data.
        //Log it to console accordingly.
        console.log("Error syncing");
        console.log(err);
      } else {
        logs = [];
        metrics = [];
        //var response = syncRequest.responseText;
        //console.log("SYNC", syncObject, callOptions.uri, err, r.body);
      }
      ("function" === typeof callback) && callback.apply(this, [err, r, data]);
    });
  };

  /**
   * Function that is called during the window.onerror handler. Grabs all parameters sent by that function.
   *
   * @public
   * @param {string} crashEvent
   * @param {string} url
   * @param {string} line
   *
   */
  Apigee.MonitoringClient.catchCrashReport = function(crashEvent, url, line) {
    logCrash({
      tag: "CRASH",
      logMessage: "Error:" + crashEvent + " for url:" + url + " on line:" + line
    });
  };

  Apigee.MonitoringClient.prototype.startLocationCapture = function() {
    var self = this;
    if (self.deviceConfig.locationCaptureEnabled && typeof navigator !== "undefined" && typeof navigator.geolocation !== "undefined") {
      var geoSuccessCallback = function(position) {
        self.sessionMetrics.latitude = position.coords.latitude;
        self.sessionMetrics.longitude = position.coords.longitude;
      }
      var geoErrorCallback = function() {
        console.log("Location access is not available.")
      }
      navigator.geolocation.getCurrentPosition(geoSuccessCallback, geoErrorCallback);
    }
  }
  Apigee.MonitoringClient.prototype.detectAppPlatform = function(sessionSummary) {
    var self = this;
    var callbackHandler_Titanium = function(e) {
      //Framework is appcelerator
      sessionSummary.devicePlatform = e.name;
      sessionSummary.deviceOSVersion = e.osname;

      //Get the device id if we want it. If we dont, but we want it obfuscated generate
      //a one off id and attach it to localStorage.
      if (self.deviceConfig.deviceIdCaptureEnabled) {
        if (self.deviceConfig.obfuscateDeviceId) {
          sessionSummary.deviceId = generateDeviceId();
        } else {
          sessionSummary.deviceId = e.uuid;
        }
      } else {
        if (this.deviceConfig.obfuscateDeviceId) {
          sessionSummary.deviceId = generateDeviceId();
        } else {
          sessionSummary.deviceId = UNKNOWN;
        }
      }

      sessionSummary.deviceModel = e.model;
      sessionSummary.networkType = e.networkType;
    };
    var callbackHandler_PhoneGap = function(e) {
      if ("device" in window) {
        sessionSummary.devicePlatform = window.device.platform;
        sessionSummary.deviceOSVersion = window.device.version;
        sessionSummary.deviceModel = window.device.name;
      } else if (window.cordova) {
        sessionSummary.devicePlatform = window.cordova.platformId;
        sessionSummary.deviceOSVersion = UNKNOWN;
        sessionSummary.deviceModel = UNKNOWN;
      }
      if (typeof navigator !== "undefined" && "connection" in navigator) {
        sessionSummary.networkType = navigator.connection.type || UNKNOWN;
      }

      //Get the device id if we want it. If we dont, but we want it obfuscated generate
      //a one off id and attach it to localStorage.
      if (self.deviceConfig.deviceIdCaptureEnabled) {
        if (self.deviceConfig.obfuscateDeviceId) {
          sessionSummary.deviceId = generateDeviceId();
        } else {
          sessionSummary.deviceId = window.device.uuid;
        }
      } else {
        if (this.deviceConfig.obfuscateDeviceId) {
          sessionSummary.deviceId = generateDeviceId();
        } else {
          sessionSummary.deviceId = UNKNOWN;
        }
      }
      return sessionSummary;
    };
    var callbackHandler_Trigger = function(sessionSummary) {
      var os = UNKNOWN;
      if (forge.is.ios()) {
        os = "iOS";
      } else if (forge.is.android()) {
        os = "Android";
      }
      sessionSummary.devicePlatform = UNKNOWN;
      sessionSummary.deviceOSVersion = os;

      //Get the device id if we want it. Trigger.io doesn't expose device id APIs
      if (self.deviceConfig.deviceIdCaptureEnabled) {
        sessionSummary.deviceId = generateDeviceId();
      } else {
        sessionSummary.deviceId = UNKNOWN;
      }

      sessionSummary.deviceModel = UNKNOWN;
      sessionSummary.networkType = forge.is.connection.wifi() ? "WIFI" : UNKNOWN;
      return sessionSummary;
    };
    //We're checking if it's a phonegap app.
    //If so let's use APIs exposed by phonegap to collect device info.
    //If not let's fallback onto stuff we should collect ourselves.
    if (isPhoneGap()) {
      //framework is phonegap.
      sessionSummary = callbackHandler_PhoneGap(sessionSummary);
    } else if (isTrigger()) {
      //Framework is trigger
      sessionSummary = callbackHandler_Trigger(sessionSummary);
    } else if (isTitanium()) {
      Ti.App.addEventListener("analytics:platformMetrics", callbackHandler_Titanium);
    } else {
      //Can't detect framework assume browser.
      //Here we want to check for localstorage and make sure the browser has it
      if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
        //If no uuid is set in localstorage create a new one, and set it as the session's deviceId
        if (self.deviceConfig.deviceIdCaptureEnabled) {
          sessionSummary.deviceId = generateDeviceId();
        }
      }

      if (typeof navigator !== "undefined" && typeof navigator.userAgent !== "undefined") {
        //Small hack to make all device names consistent.
        var browserData = determineBrowserType(navigator.userAgent, navigator.appName);
        sessionSummary.devicePlatform = browserData.devicePlatform;
        sessionSummary.deviceOSVersion = browserData.deviceOSVersion;
        if (typeof navigator.language !== "undefined") {
          sessionSummary.localLanguage = navigator.language;
        }

      }
    }
    if (isTitanium()) {
      Ti.App.fireEvent("analytics:attachReady");
    }
    return sessionSummary;
  }
  /**
   * Registers a device with Apigee Monitoring. Generates a new UUID for a device and collects relevant info on it.
   *
   * @method registerDevice
   * @public
   *
   */
  Apigee.MonitoringClient.prototype.startSession = function() {
    if ((this.configuration === null) || (this.configuration === "undefined")) {
      return;
    }
    //If the user agent string exists on the device
    var self = this;
    var sessionSummary = {};
    //timeStamp goes first because it is used in other properties
    sessionSummary.timeStamp = timeStamp();
    //defaults for other properties
    sessionSummary.appConfigType = this.appConfigType;
    sessionSummary.appId = this.appId.toString();
    sessionSummary.applicationVersion = ("undefined" !== typeof this.appVersion) ? this.appVersion.toString() : UNKNOWN;
    sessionSummary.batteryLevel = "-100";
    sessionSummary.deviceCountry = UNKNOWN;
    sessionSummary.deviceId = UNKNOWN;
    sessionSummary.deviceModel = UNKNOWN;
    sessionSummary.deviceOSVersion = UNKNOWN;
    sessionSummary.devicePlatform = UNKNOWN;
    sessionSummary.localCountry = UNKNOWN;
    sessionSummary.localLanguage = UNKNOWN;
    sessionSummary.networkCarrier = UNKNOWN;
    sessionSummary.networkCountry = UNKNOWN;
    sessionSummary.networkSubType = UNKNOWN;
    sessionSummary.networkType = UNKNOWN;
    sessionSummary.sdkType = SDKTYPE;
    sessionSummary.sessionId = randomUUID();
    sessionSummary.sessionStartTime = sessionSummary.timeStamp;

    self.startLocationCapture();

    self.sessionMetrics = self.detectAppPlatform(sessionSummary);
  };
  /**
   * Method to encapsulate the monkey patching of AJAX methods. We pass in the XMLHttpRequest object for monkey patching.
   *
   * @public
   * @param {XMLHttpRequest} XHR
   *
   */
  Apigee.MonitoringClient.prototype.patchNetworkCalls = function(XHR) {
    "use strict";
    var apigee = this;
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;

    XHR.prototype.open = function(method, url, async, user, pass) {
      this._method = method;
      this._url = url;
      open.call(this, method, url, async, user, pass);
    };

    XHR.prototype.send = function(data) {
      var self = this;
      var startTime;
      var oldOnReadyStateChange;
      var method = this._method;
      var url = this._url;

      function onReadyStateChange() {
        if (self.readyState == 4) // complete
        {
          //gap_exec and any other platform specific filtering here
          //gap_exec is used internally by phonegap, and shouldn't be logged.
          var monitoringURL = apigee.getMonitoringURL();

          if (url.indexOf("/!gap_exec") === -1 && url.indexOf(monitoringURL) === -1) {
            var endTime = timeStamp();
            var latency = endTime - startTime;
            var summary = {
              url: url,
              startTime: startTime.toString(),
              endTime: endTime.toString(),
              numSamples: "1",
              latency: latency.toString(),
              timeStamp: startTime.toString(),
              httpStatusCode: self.status.toString(),
              responseDataSize: self.responseText.length.toString()
            };
            if (self.status == 200) {
              //Record the http call here
              summary.numErrors = "0";
              apigee.logNetworkCall(summary);
            } else {
              //Record a connection failure here
              summary.numErrors = "1";
              apigee.logNetworkCall(summary);
            }
          } else {
            //console.log('ignoring network perf for url ' + url);
          }
        }

        if (oldOnReadyStateChange) {
          oldOnReadyStateChange();
        }
      }

      if (!this.noIntercept) {
        startTime = timeStamp();

        if (this.addEventListener) {
          this.addEventListener("readystatechange", onReadyStateChange, false);
        } else {
          oldOnReadyStateChange = this.onreadystatechange;
          this.onreadystatechange = onReadyStateChange;
        }
      }

      send.call(this, data);
    }
  };

  Apigee.MonitoringClient.prototype.patchLoggingCalls = function() {
    //Hacky way of tapping into this and switching it around but it'll do.
    //We assume that the first argument is the intended log message. Except assert which is the second message.
    var self = this;
    //var global=window||global;
    var original = global.console
    global.console = {
      log: function() {
        self.logInfo({
          tag: "CONSOLE",
          logMessage: arguments[0]
        });
        original.log.apply(original, arguments);
      },
      warn: function() {
        self.logWarn({
          tag: "CONSOLE",
          logMessage: arguments[0]
        });
        original.warn.apply(original, arguments);
      },
      error: function() {
        self.logError({
          tag: "CONSOLE",
          logMessage: arguments[0]
        });
        original.error.apply(original, arguments);
      },
      assert: function() {
        self.logAssert({
          tag: "CONSOLE",
          logMessage: arguments[1]
        });
        original.assert.apply(original, arguments);
      },
      debug: function() {
        self.logDebug({
          tag: "CONSOLE",
          logMessage: arguments[0]
        });
        original.debug.apply(original, arguments);
      }
    }

    if (isTitanium()) {
      //Patch console.log to work in Titanium as well.
      var originalTitanium = Ti.API;
      window.console.log = function() {
        originalTitanium.info.apply(originalTitanium, arguments);
      };

      Ti.API = {
        info: function() {
          self.logInfo({
            tag: "CONSOLE_TITANIUM",
            logMessage: arguments[0]
          });
          originalTitanium.info.apply(originalTitanium, arguments);
        },
        log: function() {
          var level = arguments[0];
          if (level === "info") {
            self.logInfo({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          } else if (level === "warn") {
            self.logWarn({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          } else if (level === "error") {
            self.logError({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          } else if (level === "debug") {
            self.logDebug({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          } else if (level === "trace") {
            self.logAssert({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          } else {
            self.logInfo({
              tag: "CONSOLE_TITANIUM",
              logMessage: arguments[1]
            });
          }
          originalTitanium.log.apply(originalTitanium, arguments);
        }
      }
    }

  };

  /**
   * Prepares data for syncing on window close.
   *
   * @method prepareSync
   * @public
   *
   */
  Apigee.MonitoringClient.prototype.prepareSync = function(callback) {
    var syncObject = {};
    var self = this;
    //Just in case something bad happened.
    if (typeof self.sessionMetrics !== "undefined") {
      syncObject.sessionMetrics = self.sessionMetrics;
    }
    var syncFlag = false;
    this.syncDate = timeStamp();
    //Go through each of the aggregated metrics
    //If there are unreported metrics present add them to the object to be sent across the network
    if (metrics.length > 0) {
      syncFlag = true;
    }

    if (logs.length > 0) {
      syncFlag = true;
    }

    syncObject.logs = logs;
    syncObject.metrics = metrics;

    //If there is data to sync go ahead and do it.
    if (syncFlag && !self.testMode) {
      this.sync(syncObject, callback);
    }
  };

  /**
   * Logs a user defined message.
   *
   * @method logMessage
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logMessage = function(options) {
    var log = options || {};
    var cleansedLog = {
      logLevel: log.logLevel,
      logMessage: log.logMessage.substring(0, 250),
      tag: log.tag,
      timeStamp: timeStamp()
    }
    logs.push(cleansedLog);
  };

  /**
   * Logs a user defined verbose message.
   *
   * @method logDebug
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logVerbose = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.verbose;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.verbose) {
      this.logMessage(options);
    }
  };

  /**
   * Logs a user defined debug message.
   *
   * @method logDebug
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logDebug = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.debug;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.debug) {
      this.logMessage(options);
    }
  };

  /**
   * Logs a user defined informational message.
   *
   * @method logInfo
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logInfo = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.info;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.info) {
      this.logMessage(options);
    }
  };

  /**
   * Logs a user defined warning message.
   *
   * @method logWarn
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logWarn = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.warn;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.warn) {
      this.logMessage(options);
    }
  };

  /**
   * Logs a user defined error message.
   *
   * @method logError
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logError = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.error;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.error) {
      this.logMessage(options);
    }
  };

  /**
   * Logs a user defined assert message.
   *
   * @method logAssert
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logAssert = function(options) {
    var logOptions = options || {};
    logOptions.logLevel = LOGLEVELS.assert;
    if (this.deviceConfig && this.deviceConfig.logLevelToMonitor >= LOGLEVELNUMBERS.assert) {
      this.logMessage(options);
    }
  };

  /**
   * Internal function for encapsulating crash log catches. Not directly callable.
   * Needed because of funkiness with the errors being thrown solely on the window
   *
   */

  function logCrash(options) {
    var log = options || {};
    var cleansedLog = {
      logLevel: LOGLEVELS.assert,
      logMessage: log.logMessage,
      tag: log.tag,
      timeStamp: timeStamp()
    }
    logs.push(cleansedLog);
  }

  /**
   * Logs a network call.
   *
   * @method logNetworkCall
   * @public
   * @param {object} options
   *
   */
  Apigee.MonitoringClient.prototype.logNetworkCall = function(options) {
    metrics.push(options);
  };


  /**
   * Retrieves monitoring URL.
   *
   * @method getMonitoringURL
   * @public
   * @returns {string} value
   *
   */
  Apigee.MonitoringClient.prototype.getMonitoringURL = function() {
    return this.URI + '/' + this.orgName + '/' + this.appName + '/apm/';
  };



  /**
   * Gets custom config parameters. These are set by user in dashboard.
   *
   * @method getConfig
   * @public
   * @param {string} key
   * @returns {stirng} value
   *
   * TODO: Once there is a dashboard plugged into the API implement this so users can set
   * custom configuration parameters for their applications.
   */
  Apigee.MonitoringClient.prototype.getConfig = function(key) {

  };

  //TEST HELPERS NOT REALLY MEANT TO BE USED OUTSIDE THAT CONTEXT.
  //Simply exposes some internal data that is collected.

  Apigee.MonitoringClient.prototype.logs = function() {
    return logs;
  };

  Apigee.MonitoringClient.prototype.metrics = function() {
    return metrics;
  };

  Apigee.MonitoringClient.prototype.getSessionMetrics = function() {
    return this.sessionMetrics;
  };

  Apigee.MonitoringClient.prototype.clearMetrics = function() {
    logs = [];
    metrics = [];
  };
  Apigee.MonitoringClient.prototype.mixin = function(destObject) {
    var props = ['bind', 'unbind', 'trigger'];

    for (var i = 0; i < props.length; i++) {
      destObject.prototype[props[i]] = MicroEvent.prototype[props[i]];
    }
  }
  //UUID Generation function unedited

  /** randomUUID.js - Version 1.0
   *
   * Copyright 2008, Robert Kieffer
   *
   * This software is made available under the terms of the Open Software License
   * v3.0 (available here: http://www.opensource.org/licenses/osl-3.0.php )
   *
   * The latest version of this file can be found at:
   * http://www.broofa.com/Tools/randomUUID.js
   *
   * For more information, or to comment on this, please go to:
   * http://www.broofa.com/blog/?p=151
   */

  /**
   * Create and return a "version 4" RFC-4122 UUID string.
   */

  function randomUUID() {
    var s = [],
      itoh = '0123456789ABCDEF',
      i;

    // Make array of random hex digits. The UUID only has 32 digits in it, but we
    // allocate an extra items to make room for the '-'s we'll be inserting.
    for (i = 0; i < 36; i++) {
      s[i] = Math.floor(Math.random() * 0x10);
    }

    // Conform to RFC-4122, section 4.4
    s[14] = 4; // Set 4 high bits of time_high field to version
    s[19] = (s[19] & 0x3) | 0x8; // Specify 2 high bits of clock sequence

    // Convert to hex chars
    for (i = 0; i < 36; i++) {
      s[i] = itoh[s[i]];
    }

    // Insert '-'s
    s[8] = s[13] = s[18] = s[23] = '-';

    return s.join('');
  }

  //Generate an epoch timestamp string

  function timeStamp() {
    return new Date().getTime().toString();
  }

  //Generate a device id, and attach it to localStorage.
  function generateDeviceId() {
    var deviceId = "UNKNOWN";
    try {
      if ("undefined" === typeof localStorage) {
        throw new Error("device or platform does not support local storage")
      }
      if (window.localStorage.getItem("uuid") === null) {
        window.localStorage.setItem("uuid", randomUUID());
      }
      deviceId = window.localStorage.getItem("uuid");
    } catch (e) {
      deviceId = randomUUID();
      console.warn(e);
    } finally {
      return deviceId;
    }
  }

  //Helper. Determines if the platform device is phonegap

  function isPhoneGap() {
    return (typeof cordova !== "undefined") || (typeof PhoneGap !== "undefined") || (typeof window !== "undefined" && typeof window.device !== "undefined");
  }

  //Helper. Determines if the platform device is trigger.io

  function isTrigger() {
    return (typeof window !== "undefined" && typeof window.forge !== "undefined");
  }

  //Helper. Determines if the platform device is titanium.

  function isTitanium() {
    return (typeof Titanium !== "undefined");
  }

  /**
   * @method determineBrowserType
   */
  var BROWSERS = ["Opera", "MSIE", "Safari", "Chrome", "Firefox"];

  function createBrowserRegex(browser) {
    return new RegExp('\\b(' + browser + ')\\/([^\\s]+)');
  }

  function createBrowserTest(userAgent, positive, negatives) {
    var matches = BROWSER_REGEX[positive].exec(userAgent);
    negatives = negatives || [];
    if (matches && matches.length && !negatives.some(function(negative) {
      return BROWSER_REGEX[negative].exec(userAgent)
    })) {
      return matches.slice(1, 3);
    }
  }
  var BROWSER_REGEX = ["Seamonkey", "Firefox", "Chromium", "Chrome", "Safari", "Opera"].reduce(function(p, c) {
    p[c] = createBrowserRegex(c);
    return p;
  }, {});
  BROWSER_REGEX["MSIE"] = new RegExp(";(MSIE) ([^\\s]+)");
  var BROWSER_TESTS = [
    ["MSIE"],
    ["Opera", []],
    ["Seamonkey", []],
    ["Firefox", ["Seamonkey"]],
    ["Chromium", []],
    ["Chrome", ["Chromium"]],
    ["Safari", ["Chromium", "Chrome"]]
  ].map(function(arr) {
    return createBrowserTest((typeof navigator !== "undefined") ? navigator.userAgent : "", arr[0], arr[1]);
  });

  function determineBrowserType(ua, appName) {
    //var ua = navigator.userAgent;
    var browserName = appName;
    var nameOffset, verOffset, verLength, ix, fullVersion = UNKNOWN;
    var browserData = {
      devicePlatform: UNKNOWN,
      deviceOSVersion: UNKNOWN
    };
    var browserData = BROWSER_TESTS.reduce(function(p, c) {
      return (c) ? c : p;
    }, "UNKNOWN");
    browserName = browserData[0];
    fullVersion = browserData[1];
    if (browserName === "MSIE") {
      browserName = "Microsoft Internet Explorer";
    }
    browserData.devicePlatform = browserName;
    browserData.deviceOSVersion = fullVersion;
    return browserData;
  }



  global[name] = {
    Client: Apigee.Client,
    Entity: Apigee.entity,
    Collection: Apigee.collection,
    Group: Apigee.group,
    MonitoringClient: Apigee.MonitoringClient,
    AUTH_CLIENT_ID: Apigee.AUTH_CLIENT_ID,
    AUTH_APP_USER: Apigee.AUTH_APP_USER,
    AUTH_NONE: Apigee.AUTH_NONE
  };
  global[name].noConflict = function() {
    if (overwrittenName) {
      global[name] = overwrittenName;
    }
    return Apigee;
  };
  return global[name];
})();
