/*
*  This module is a collection of classes designed to make working with
*  the Apigee App Services API as easy as possible.
*  Learn more at http://apigee.com/docs/usergrid
*
*   Copyright 2012 Apigee Corporation
*
*  Licensed under the Apache License, Version 2.0 (the "License");
*  you may not use this file except in compliance with the License.
*  You may obtain a copy of the License at
*
*      http://www.apache.org/licenses/LICENSE-2.0
*
*  Unless required by applicable law or agreed to in writing, software
*  distributed under the License is distributed on an "AS IS" BASIS,
*  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*  See the License for the specific language governing permissions and
*  limitations under the License.
*
*  @author rod simpson (rod@apigee.com)
*/
"use strict";
var Client = require('./entities/client'),
    Group = require('./entities/group'),
    Collection = require('./entities/collection'),
    Entity = require('./entities/entity')
    ;
var Usergrid = {
  USERGRID_SDK_VERSION : '0.10.07'
};

//authentication type constants
var AUTH_CLIENT_ID = 'CLIENT_ID';
var AUTH_APP_USER = 'APP_USER';
var AUTH_NONE = 'NONE';


exports.client = function (options){
  return new Client(options);
};
exports.entity = function(options){
  return new Entity(options);
};
exports.collection = function(options,cb){
  return new Collection(options,cb);
}
exports.group = function(options,cb){
  return new Group(options,cb);
}
exports.AUTH_CLIENT_ID = AUTH_CLIENT_ID;
exports.AUTH_APP_USER = AUTH_APP_USER;
exports.AUTH_NONE = AUTH_NONE;
