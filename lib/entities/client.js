"use strict";

//authentication type constants
var AUTH_CLIENT_ID = 'CLIENT_ID';
var AUTH_APP_USER = 'APP_USER';
var AUTH_NONE = 'NONE';

var request = require('request'),
    Group = require('./group'),
    Collection = require('./collection'),
    Entity = require('./entity')
    ;


var Client = function(options) {
  //usergrid enpoint
  this.URI = options.URI || 'https://api.usergrid.com';

  //Find your Orgname and Appname in the Admin portal (http://apigee.com/usergrid)
  if (options.orgName) {
    this.set('orgName', options.orgName);
  }
  if (options.appName) {
    this.set('appName', options.appName);
  }

  //authentication data
  this.authType = options.authType || AUTH_NONE;
  this.clientId = options.clientId;
  this.clientSecret = options.clientSecret;
  this.token = options.token || null;

  //other options
  this.buildCurl = options.buildCurl || false;
  this.logging = options.logging || false;

  //timeout and callbacks
  this._callTimeout =  options.callTimeout || 30000; //default to 30 seconds
  this._callTimeoutCallback =  options.callTimeoutCallback || null;
  this.logoutCallback =  options.logoutCallback || null;
};

/*
 *  Main function for making requests to the API.  Can be called directly.
 *
 *  options object:
 *  `method` - http method (GET, POST, PUT, or DELETE), defaults to GET
 *  `qs` - object containing querystring values to be appended to the uri
 *  `body` - object containing entity body for POST and PUT requests
 *  `endpoint` - API endpoint, for example 'users/fred'
 *  `mQuery` - boolean, set to true if running management query, defaults to false
 *
 *  @method request
 *  @public
 *  @params {object} options
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.request = function (options, callback) {
  var self = this;
  var method = options.method || 'GET';
  var endpoint = options.endpoint;
  var body = options.body || {};
  var qs = options.qs || {};
  var mQuery = options.mQuery || false; //is this a query to the management endpoint?
  var orgName = this.get('orgName');
  var appName = this.get('appName');
  if(!mQuery && !orgName && !appName){
    if (typeof(this.logoutCallback) === 'function') {
      return this.logoutCallback(true, 'no_org_or_app_name_specified');
    }
  }
  if (mQuery) {
    var uri = this.URI + '/' + endpoint;
  } else {
    var uri = this.URI + '/' + orgName + '/' + appName + '/' + endpoint;
  }

  if (this.authType === AUTH_CLIENT_ID) {
    qs['client_id'] = this.clientId;
    qs['client_secret'] = this.clientSecret;
  } else if (this.authType === AUTH_APP_USER) {
    qs['access_token'] = self.getToken();
  }

  if (this.logging) {
    console.log('calling: ' + method + ' ' + uri);
  }
  this._start = new Date().getTime();
  var callOptions = {
    method: method,
    uri: uri,
    json: body,
    qs: qs
  };
  request(callOptions, function (err, r, data) {
    if (self.buildCurl) {
      options.uri = r.request.uri.href;
      self.buildCurlCall(options);
    }
    self._end = new Date().getTime();
    if(r.statusCode === 200) {
      if (self.logging) {
        console.log('success (time: ' + self.calcTimeDiff() + '): ' + method + ' ' + uri);
      }
      callback(err, data);
    } else {
      err = true;
      if ((r.error === 'auth_expired_session_token') ||
          (r.error === 'auth_missing_credentials')   ||
          (r.error == 'auth_unverified_oath')       ||
          (r.error === 'expired_token')   ||
          (r.error === 'unauthorized')   ||
          (r.error === 'auth_invalid')) {
        //this error type means the user is not authorized. If a logout function is defined, call it
        var error = r.body.error;
        var errorDesc = r.body.error_description;
        if (self.logging) {
          console.log('Error (' + r.statusCode + ')(' + error + '): ' + errorDesc)
        }
        //if the user has specified a logout callback:
        if (typeof(self.logoutCallback) === 'function') {
          self.logoutCallback(err, data);
        } else  if (typeof(callback) === 'function') {
          callback(err, data);
        }
      } else {
        var error = r.body.error;
        var errorDesc = r.body.error_description;
        if (self.logging) {
          console.log('Error (' + r.statusCode + ')(' + error + '): ' + errorDesc);
        }
        if (typeof(callback) === 'function') {
          callback(err, data);
        }
      }
    }
  });
}
/*
 *  function for building asset urls
 *
 *  @method buildAssetURL
 *  @public
 *  @params {string} uuid
 *  @return {string} assetURL
 */
Client.prototype.buildAssetURL = function(uuid) {
  var self = this;
  var qs = {};
  var assetURL = this.URI + '/' + this.orgName + '/' + this.appName + '/assets/' + uuid + '/data';

  if (self.getToken()) {
    qs['access_token'] = self.getToken();
  }

  //append params to the path
  var encoded_params = encodeParams(qs);
  if (encoded_params) {
    assetURL += "?" + encoded_params;
  }

  return assetURL;
}
/*
 *  method to encode the query string parameters
 *
 *  @method encodeParams
 *  @public
 *  @params {object} params - an object of name value pairs that will be urlencoded
 *  @return {string} Returns the encoded string
 */
var encodeParams = function (params) {
  var tail = [];
  var item = [];
  if (params instanceof Array) {
    for (var i in params) {
      item = params[i];
      if ((item instanceof Array) && (item.length > 1)) {
        tail.push(item[0] + "=" + encodeURIComponent(item[1]));
      }
    }
  } else {
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        var value = params[key];
        if (value instanceof Array) {
          for (var i in value) {
            item = value[i];
            tail.push(key + "=" + encodeURIComponent(item));
          }
        } else {
          tail.push(key + "=" + encodeURIComponent(value));
        }
      }
    }
  }
  return tail.join("&");
}

/*
 *  Main function for creating new groups. Call this directly.
 *
 *  @method createGroup
 *  @public
 *  @params {string} path
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.createGroup = function(options, callback) {
  var getOnExist = options.getOnExist || false;

  var options = {
    path: options.path,
    client: this,
    data:options
  }

  var group = new Group(options);
  group.fetch(function(err, data){
    var okToSave = (err && 'service_resource_not_found' === data.error || 'no_name_specified' === data.error || 'null_pointer' === data.error) || (!err && getOnExist);
    if (okToSave) {
      group.save(function(err, data){
        if (typeof(callback) === 'function') {
          callback(err, group);
        }
      });
    } else {
      if(typeof(callback) === 'function') {
        callback(err, group);
      }
    }
  });
}

/*
 *  Main function for creating new entities - should be called directly.
 *
 *  options object: options {data:{'type':'collection_type', 'key':'value'}, uuid:uuid}}
 *
 *  @method createEntity
 *  @public
 *  @params {object} options
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.createEntity = function (options, callback) {
  // todo: replace the check for new / save on not found code with simple save
  // when users PUT on no user fix is in place.
  /*
   var options = {
   client:this,
   data:options
   }
   var entity = new Entity(options);
   entity.save(function(err, data) {
   if (typeof(callback) === 'function') {
   callback(err, entity);
   }
   });
   */
  var getOnExist = options.getOnExist || false; //if true, will return entity if one already exists
  var options = {
    client:this,
    data:options
  }
  var entity = new Entity(options);
  entity.fetch(function(err, data) {
    //if the fetch doesn't find what we are looking for, or there is no error, do a save
    var okToSave = (err && 'service_resource_not_found' === data.error || 'no_name_specified' === data.error || 'null_pointer' === data.error) || (!err && getOnExist);
    if(okToSave) {
      entity.set(options.data); //add the data again just in case
      entity.save(function(err, data) {
        if (typeof(callback) === 'function') {
          callback(err, entity, data);
        }
      });
    } else {
      if (typeof(callback) === 'function') {
        callback(err, entity, data);
      }
    }
  });

}

/*
 *  Main function for getting existing entities - should be called directly.
 *
 *  You must supply a uuid or (username or name). Username only applies to users.
 *  Name applies to all custom entities
 *
 *  options object: options {data:{'type':'collection_type', 'name':'value', 'username':'value'}, uuid:uuid}}
 *
 *  @method createEntity
 *  @public
 *  @params {object} options
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.getEntity = function (options, callback) {
  var options = {
    client:this,
    data:options
  }
  var entity = new Entity(options);
  entity.fetch(function(err, data) {
    if (typeof(callback) === 'function') {
      callback(err, entity, data);
    }
  });
}

/*
 *  Main function for restoring an entity from serialized data.
 *
 *  serializedObject should have come from entityObject.serialize();
 *
 *  @method restoreEntity
 *  @public
 *  @param {string} serializedObject
 *  @return {object} Entity Object
 */
Client.prototype.restoreEntity = function (serializedObject) {
  var data = JSON.parse(serializedObject);
  var options = {
    client:this,
    data:data
  }
  var entity = new Entity(options);
  return entity;
}

/*
 *  Main function for creating new collections - should be called directly.
 *
 *  options object: options {client:client, type: type, qs:qs}
 *
 *  @method createCollection
 *  @public
 *  @params {object} options
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.createCollection = function (options, callback) {
  options.client = this;
  var collection = new Collection(options, function(err, data) {
    if (typeof(callback) === 'function') {
      callback(err, collection, data);
    }
  });
}

/*
 *  Main function for restoring a collection from serialized data.
 *
 *  serializedObject should have come from collectionObject.serialize();
 *
 *  @method restoreCollection
 *  @public
 *  @param {string} serializedObject
 *  @return {object} Collection Object
 */
Client.prototype.restoreCollection = function (serializedObject) {
  var data = JSON.parse(serializedObject);
  data.client = this;
  var collection = new Collection(data);
  return collection;
}

/*
 *  Main function for retrieving a user's activity feed.
 *
 *  @method getFeedForUser
 *  @public
 *  @params {string} username
 *  @param {function} callback
 *  @return {callback} callback(err, data, activities)
 */
Client.prototype.getFeedForUser = function(username, callback) {
  var options = {
    method: "GET",
    endpoint: "users/"+username+"/feed"
  }

  this.request(options, function(err, data){
    if(typeof(callback) === "function") {
      if(err) {
        callback(err);
      } else {
        callback(err, data, data.entities);
      }
    }
  });
}

/*
 *  Function for creating new activities for the current user - should be called directly.
 *
 *  //user can be any of the following: "me", a uuid, a username
 *  Note: the "me" alias will reference the currently logged in user (e.g. 'users/me/activties')
 *
 *  //build a json object that looks like this:
 *  var options =
 *  {
 *    "actor" : {
 *      "displayName" :"myusername",
 *      "uuid" : "myuserid",
 *      "username" : "myusername",
 *      "email" : "myemail",
 *      "picture": "http://path/to/picture",
 *      "image" : {
 *          "duration" : 0,
 *          "height" : 80,
 *          "url" : "http://www.gravatar.com/avatar/",
 *          "width" : 80
 *      },
 *    },
 *    "verb" : "post",
 *    "content" : "My cool message",
 *    "lat" : 48.856614,
 *    "lon" : 2.352222
 *  }
 *
 *  @method createEntity
 *  @public
 *  @params {string} user // "me", a uuid, or a username
 *  @params {object} options
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.createUserActivity = function (user, options, callback) {
  options.type = 'users/'+user+'/activities';
  var options = {
    client:this,
    data:options
  }
  var entity = new Entity(options);
  entity.save(function(err, data) {
    if (typeof(callback) === 'function') {
      callback(err, entity);
    }
  });
}

/*
 *  Function for creating user activities with an associated user entity.
 *
 *  user object:
 *  The user object passed into this function is an instance of Entity.
 *
 *  @method createUserActivityWithEntity
 *  @public
 *  @params {object} user
 *  @params {string} content
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.createUserActivityWithEntity = function(user, content, callback) {
  var username = user.get("username");
  var options = {
    actor: {
      "displayName":username,
      "uuid":user.get("uuid"),
      "username":username,
      "email":user.get("email"),
      "picture":user.get("picture"),
      "image": {
        "duration":0,
        "height":80,
        "url":user.get("picture"),
        "width":80
      }
    },
    "verb":"post",
    "content":content };

  this.createUserActivity(username, options, callback);

}

/*
 *  A private method to get call timing of last call
 */
Client.prototype.calcTimeDiff = function () {
  var seconds = 0;
  var time = this._end - this._start;
  try {
    seconds = ((time/10) / 60).toFixed(2);
  } catch(e) { return 0; }
  return seconds;
}

/*
 *  A public method to store the OAuth token for later use - uses localstorage if available
 *
 *  @method setToken
 *  @public
 *  @params {string} token
 *  @return none
 */
Client.prototype.setToken = function (token) {
  this.set('token', token);
}

/*
 *  A public method to get the OAuth token
 *
 *  @method getToken
 *  @public
 *  @return {string} token
 */
Client.prototype.getToken = function () {
  return this.get('token');
}

Client.prototype.setObject = function(key, value) {
  if (value) {
    value = JSON.stringify(value);
  }
  this.set(key, value);
}

Client.prototype.set = function (key, value) {
  var keyStore =  'apigee_' + key;
  this[key] = value;
  if(typeof(Storage)!=="undefined"){
    if (value) {
      localStorage.setItem(keyStore, value);
    } else {
      localStorage.removeItem(keyStore);
    }
  }
}

Client.prototype.getObject = function(key) {
  return JSON.parse(this.get(key));
}

Client.prototype.get = function (key) {
  var keyStore = 'apigee_' + key;
  if (this[key]) {
    return this[key];
  } else if(typeof(Storage)!=="undefined") {
    return localStorage.getItem(keyStore);
  }
  return null;
}

/*
 * A public facing helper method for signing up users
 *
 * @method signup
 * @public
 * @params {string} username
 * @params {string} password
 * @params {string} email
 * @params {string} name
 * @param {function} callback
 * @return {callback} callback(err, data)
 */
Client.prototype.signup = function(username, password, email, name, callback) {
  var self = this;
  var options = {
    type:"users",
    username:username,
    password:password,
    email:email,
    name:name
  };

  this.createEntity(options, callback);
}

/*
 *
 *  A public method to log in an app user - stores the token for later use
 *
 *  @method login
 *  @public
 *  @params {string} username
 *  @params {string} password
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.login = function (username, password, callback) {
  var self = this;
  var options = {
    method:'POST',
    endpoint:'token',
    body:{
      username: username,
      password: password,
      grant_type: 'password'
    }
  };
  this.request(options, function(err, data) {
    var user = {};
    if (err && self.logging) {
      console.log('error trying to log user in');
    } else {
      var options = {
        client:self,
        data:data.user
      }
      user = new Entity(options);
      self.setToken(data.access_token);
    }
    if (typeof(callback) === 'function') {
      callback(err, data, user);
    }
  });
}


Client.prototype.reAuthenticateLite = function (callback) {
  var self = this;
  var options = {
    method:'GET',
    endpoint:'management/me',
    mQuery:true
  };
  this.request(options, function(err, response) {
    if (err && self.logging) {
      console.log('error trying to re-authenticate user');
    } else {

      //save the re-authed token and current email/username
      self.setToken(response.access_token);

    }
    if (typeof(callback) === 'function') {
      callback(err);
    }
  });
}


Client.prototype.reAuthenticate = function (email, callback) {
  var self = this;
  var options = {
    method:'GET',
    endpoint:'management/users/'+email,
    mQuery:true
  };
  this.request(options, function(err, response) {
    var organizations = {};
    var applications = {};
    var user = {};
    if (err && self.logging) {
      console.log('error trying to full authenticate user');
    } else {
      var data = response.data;
      self.setToken(data.token);
      self.set('email', data.email);

      //delete next block and corresponding function when iframes are refactored
      localStorage.setItem('accessToken', data.token);
      localStorage.setItem('userUUID', data.uuid);
      localStorage.setItem('userEmail', data.email);
      //end delete block


      var userData = {
        "username" : data.username,
        "email" : data.email,
        "name" : data.name,
        "uuid" : data.uuid
      }
      var options = {
        client:self,
        data:userData
      }
      user = new Entity(options);

      organizations = data.organizations;
      var org = '';
      try {
        //if we have an org stored, then use that one. Otherwise, use the first one.
        var existingOrg = self.get('orgName');
        org = (organizations[existingOrg])?organizations[existingOrg]:organizations[Object.keys(organizations)[0]];
        self.set('orgName', org.name);
      } catch(e) {
        err = true;
        if (self.logging) { console.log('error selecting org'); }
      } //should always be an org

      applications = self.parseApplicationsArray(org);
      self.selectFirstApp(applications);

      self.setObject('organizations', organizations);
      self.setObject('applications', applications);

    }
    if (typeof(callback) === 'function') {
      callback(err, data, user, organizations, applications);
    }
  });
}

/*
 *  A public method to log in an app user with facebook - stores the token for later use
 *
 *  @method loginFacebook
 *  @public
 *  @params {string} username
 *  @params {string} password
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.loginFacebook = function (facebookToken, callback) {
  var self = this;
  var options = {
    method:'GET',
    endpoint:'auth/facebook',
    qs:{
      fb_access_token: facebookToken
    }
  };
  this.request(options, function(err, data) {
    var user = {};
    if (err && self.logging) {
      console.log('error trying to log user in');
    } else {
      var options = {
        client: self,
        data: data.user
      }
      user = new Entity(options);
      self.setToken(data.access_token);
    }
    if (typeof(callback) === 'function') {
      callback(err, data, user);
    }
  });
}

/*
 *  A public method to get the currently logged in user entity
 *
 *  @method getLoggedInUser
 *  @public
 *  @param {function} callback
 *  @return {callback} callback(err, data)
 */
Client.prototype.getLoggedInUser = function (callback) {
  if (!this.getToken()) {
    callback(true, null, null);
  } else {
    var self = this;
    var options = {
      method:'GET',
      endpoint:'users/me'
    };
    this.request(options, function(err, data) {
      if (err) {
        if (self.logging) {
          console.log('error trying to log user in');
        }
        if (typeof(callback) === 'function') {
          callback(err, data, null);
        }
      } else {
        var options = {
          client:self,
          data:data.entities[0]
        }
        var user = new Entity(options);
        if (typeof(callback) === 'function') {
          callback(err, data, user);
        }
      }
    });
  }
}

/*
 *  A public method to test if a user is logged in - does not guarantee that the token is still valid,
 *  but rather that one exists
 *
 *  @method isLoggedIn
 *  @public
 *  @return {boolean} Returns true the user is logged in (has token and uuid), false if not
 */
Client.prototype.isLoggedIn = function () {
  if (this.getToken()) {
    return true;
  }
  return false;
}

/*
 *  A public method to log out an app user - clears all user fields from client
 *
 *  @method logout
 *  @public
 *  @return none
 */
Client.prototype.logout = function () {
  this.setToken(null);
}

/*
 *  A private method to build the curl call to display on the command line
 *
 *  @method buildCurlCall
 *  @private
 *  @param {object} options
 *  @return {string} curl
 */
Client.prototype.buildCurlCall = function (options) {
  var curl = 'curl';
  var method = (options.method || 'GET').toUpperCase();
  var body = options.body || {};
  var uri = options.uri;

  //curl - add the method to the command (no need to add anything for GET)
  if (method === 'POST') {curl += ' -X POST'; }
  else if (method === 'PUT') { curl += ' -X PUT'; }
  else if (method === 'DELETE') { curl += ' -X DELETE'; }
  else { curl += ' -X GET'; }

  //curl - append the path
  curl += ' ' + uri;

  //curl - add the body
  body = JSON.stringify(body)//only in node module
  if (body !== '"{}"' && method !== 'GET' && method !== 'DELETE') {
    //curl - add in the json obj
    curl += " -d '" + body + "'";
  }

  //log the curl command to the console
  console.log(curl);

  return curl;
}

Client.prototype.getDisplayImage = function (email, picture, size) {
  try {
    if (picture) {
      return picture;
    }
    var size = size || 50;
    if (email.length) {
      return 'https://secure.gravatar.com/avatar/' + MD5(email) + '?s=' + size + encodeURI("&d=https://apigee.com/usergrid/images/user_profile.png");
    } else {
      return 'https://apigee.com/usergrid/images/user_profile.png';
    }
  } catch(e) {
    return 'https://apigee.com/usergrid/images/user_profile.png';
  }
};

module.exports = Client;