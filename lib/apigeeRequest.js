module.exports=(function() {
  var name = 'request',
    global = this,
    overwrittenName = global[name],
    request = require("request")
  ;
  function timeStamp() {
    return new Date().getTime().toString();
  }
  function ApigeeRequest(options, callback){
    var apigee=options.client||this, 
      url=options.uri,
      startTime;
    function _callback(error, response, body){
      if("function" === typeof callback){
        callback.apply(apigee, [error, response, body]);
      }
        if(apigee.monitor){
          var monitoringURL = apigee.monitor.getMonitoringURL();

          //gap_exec and any other platform specific filtering here
          //gap_exec is used internally by phonegap, and shouldn't be logged.
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
              httpStatusCode: response.statusCode.toString(),
              responseDataSize: response.headers['content-length'].toString()
            };
            if (response.statusCode == 200) {
              //Record the http call here
              summary.numErrors = "0";
            } else {
              //Record a connection failure here
              summary.numErrors = "1";
            }
            apigee.monitor.logNetworkCall(summary);
          } else {
            //console.log('ignoring network perf for url ' + url);
          }
        }else{
          //console.warn("Monitoring is not enabled or this request was not made by an apigee client");
        }
    }
    if (!apigee.noIntercept) {
      startTime = timeStamp();
    }
    request.apply(apigee, [options, _callback]);
  }

  global[name] =  ApigeeRequest;

  global[name].noConflict = function() {
    if(overwrittenName){
      global[name] = overwrittenName;
    }
    return ApigeeRequest;
  };
  return global[name];
})();
