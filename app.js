'use strict';
const express = require("express");
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const glob = require('glob');  
const url  = require('url');
const shajs = require('sha.js');
const Web3 = require('web3');
const Git = require("nodegit");


let web3 = "";
let owContract = "";
let host_port = 15678;

const db = __dirname+'/db';
const hostDB = db+'/webdata';
const metaDB = db+'/meta';
const metaFile = metaDB+'/meta.json';
const configFile = __dirname+'/config.json';


let _config = {};
let _meta = {};
let _tmpDt = {};

let websiteFilesLimit = 20;
let websiteSizeLimit = 512;
let userReqLimit = 20000;




function isJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

var dirInit = (path) => {
	fs.ensureDirSync(path);
};

var printMsg = (msg) => {
    if(_config["debug"]){
	   console.log(msg);
    }
};

var timestamp = () => {
    return Math.floor(Date.now() / 1000);
};

var timestampV1 = () => {
    return Math.floor(timestamp() / 10);
};

var _setConfig = (key, val) => {
    if(key != ""){
        _config[key] = val;
    }
    
    try {
        fs.outputJsonSync(configFile, _meta);
    } catch (err) {
        printMsg(err);
        process.exit(1);
    }
};

var _loadConfig = () => {
    fs.exists(configFile, function (exists) {
        if(exists){
            _config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        } else {
            _setConfig("");
        }
        
        _validateConfig();
    });
};

var _validateConfig = () => {
    if(!_config["rpc"]){
        printMsg("JSON RPC API not found in config.json file!");
        process.exit(1);
    }
    
    if(_config["host_port"]){
       host_port = _config["host_port"];
    }
    
    try {
        web3 = new Web3(new Web3.providers.HttpProvider(_config["rpc"]));
    } catch (err) {
        printMsg(err);
        process.exit(1);
    }
    
    web3.eth.net.isListening()
    .then(function() {
        _loadMeta();
    })
    .catch(function(e) {
        printMsg(e);
        process.exit(1);
    });
};

var _setMeta = (key, val) => {
    if(key != ""){
        _meta[key] = val;
    }
    
    try {
        fs.outputJsonSync(metaFile, _meta);
    } catch (err) {
        printMsg(err);
        process.exit(1);
    }
};

var _loadMeta = () => {
    try {
        let contractJsonPath = __dirname+"/contract.json";
        const contractJson= JSON.parse(fs.readFileSync(contractJsonPath));
        const contractAddr = '0x68fcb1f0d07000a84b569ccb647dd8fe320cddaa';
        
        owContract = new web3.eth.Contract(contractJson, contractAddr);
    } catch (err) {
        printMsg(err);
        process.exit(1);
    }
    
    fs.exists(metaFile, function (exists) {
        if(exists){
            _meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        } else {
            dirInit(metaDB);
            _setMeta("");
        }
        
        _initNext();
    });
};

var _removeData = (domain) => {
    let dirPath = hostDB+"/"+domain;
    printMsg("Website Removed ... ["+domain+"]");
	fs.removeSync(dirPath);
};

var storeWebsite = (domain, name, data) => {
    let dirPath = hostDB+"/"+domain;
    dirInit(dirPath);
    
    let fullPath = dirPath+"/"+name;
	fs.writeFile(fullPath, data, function (err) {
    if (err) throw err;
//        printMsg('Saved!');
    });
};

var storeWebsiteVersion = (domain, version) => {
    let dirPath = hostDB+"/"+domain;
    dirInit(dirPath);
    
    let fullPath = dirPath+"/_version";
	fs.writeFile(fullPath, version, function (err) {
    if (err) throw err;
//        printMsg('Saved!');
    });
};

var isWebsite = (domain) => {
    let fullPath = hostDB+"/"+domain;
    
	if(fs.existsSync(fullPath)) {
        return true;
    } else {
        return false;
    }
};

var isWebsitePath = (domain, path) => {
    let fullPath = _getWebPath(domain, path);
    
	if(fs.existsSync(fullPath)) {
        return true;
    } else {
        return false;
    }
};

var _getWebPath = (domain, path) => {
    if(path.substr(0, 1) === '/') {
        path = path.substr(1, path.length);
    }
    
    let fullPath = hostDB+"/"+domain+"/"+path;
    
    return fullPath;
};

var _checkValidDomain = (domain) => {
    if(!domain){
        return false;
    }
    if(domain.length <= 16){
        if(domain.includes(".")){
            return domain.split(".", 2)[1] == "ow";
        } else {
            return false;
        }
    } else {
        return false;
    }
};

var _getWebsiteVersion = (domain) => {
    let path = _getWebPath(domain, "_version");
    let _version = 0;
    
    try {
        _version = parseInt(fs.readFileSync(path, 'utf8'));
    } catch (err) {
//        printMsg(err);
    }
    
    return _version;
};

var isLocalRequest = function (ip){
    return ip === "127.0.0.1" || ip === "::ffff:127.0.0.1" || ip === "::1";
}

var _pushWebUpd = (domain, wi, _time, valid, _totalFiles) => {
    var _key = wi+""+_time;
    
    if(!_tmpDt["web"]){ _tmpDt["web"] = {}; }
    if(!_tmpDt["web"]){ _tmpDt["web"] = {}; }
    if(!_tmpDt["web"][_key]){ _tmpDt["web"][_key] = {}; }
    
    if(!_tmpDt["web"][_key]["validFiles"]){
        _tmpDt["web"][_key]["validFiles"] = 0;
        _tmpDt["web"][_key]["checkedFiles"] = 0;
    }
    
    if(valid){
        _tmpDt["web"][_key]["validFiles"] = _tmpDt["web"][_key]["validFiles"] + 1;
    }
    
    _tmpDt["web"][_key]["checkedFiles"] = _tmpDt["web"][_key]["checkedFiles"] + 1;
    
    if(_totalFiles == _tmpDt["web"][_key]["checkedFiles"]){
        _setMeta("_webprocessed", wi);
        
        if(_totalFiles  == _tmpDt["web"][_key]["validFiles"]){
            var _domainPath = _getWebPath(domain, "");
            var _tmpDomainPath = _getWebPath("tmp."+domain, "");
            
            
            fs.move(_tmpDomainPath, _domainPath, { overwrite: true }, err => {
                if (err) return printMsg(err)
            });
            
            printMsg("["+domain+"] Successfully Indexed !");
        }
        
        if(_tmpDt["web"][_key]){
            delete _tmpDt["web"][_key];
        }
    }
}

var _validateWebFiles = (webIndex, domain, totalFiles) => {
    let dmPath = hostDB+"/"+domain+"/";
    let fullPath = hostDB+"/"+domain+"/**";
    let files = glob.sync(fullPath);
    let _time = timestamp();
    
    var fileHash = "";
    var valid = true;
    files.forEach(function(file){
        if(valid){
            if(!fs.lstatSync(file).isDirectory()){
                var _filename = file.replace(dmPath, "");
                if(_filename != "_version"){
                    var data = fs.readFileSync(file, 'utf8');
                    
                    var fileHash = shajs('sha256');
                    fileHash.update(data);
                    fileHash = fileHash.digest('hex');

                    var _fileNameBytes = web3.utils.fromAscii(_filename);
                    var _hashBytes = "0x"+fileHash;

                    var tmpDomain = domain;
                    if(domain.substr(0, 4) === 'tmp.'){ tmpDomain = domain.substr(4); }
                    
                    owContract.methods.verifyDomainFileHash(tmpDomain, _fileNameBytes, _hashBytes).call(
                        function(error, result){
                            if(!result){
                                valid = false;
                                _removeData(domain);
                                _setMeta("_webprocessed", webIndex);

                                delete _tmpDt["web"][webIndex+""+_time];
                                
                                printMsg("["+domain+"] verification failed");
                            } else {
                                _pushWebUpd(tmpDomain, webIndex, _time, result, totalFiles);
                            }
                        }
                    );
                }
            }
        }
    });
};


var _validateWebsite = (domain, _totalFiles) => {
    let dmPath = hostDB+"/"+domain+"/";
    let fullPath = hostDB+"/"+domain+"/**";
    let files = glob.sync(fullPath);
    
    if(files.length > websiteFilesLimit){
        printMsg("Files exceeded from Limits: "+domain);
        return false;
    }
    
    let totalSize = 0;
    let totalFiles = 0;
    let rootHash = shajs('sha256');
    files.forEach(function(file){
        if(!fs.lstatSync(file).isDirectory()){
            var shortFilePath = file.replace(dmPath, "");
            
            if(shortFilePath != "_version"){
                var data = fs.readFileSync(file, 'utf8');
                
                totalSize += fs.statSync(file).size;
                if(totalSize > (websiteSizeLimit * 1000)){
                    printMsg("Files exceeded size limits: "+domain);
                    return false;
                }

                rootHash.update(data);
                totalFiles++;
            }
        }
    });
    rootHash = rootHash.digest('hex');
    
    if(totalFiles != _totalFiles){
        printMsg("Total files not matched: "+domain);
        return false;
    }
    
    return rootHash;
};



var _validateRequest = (req, res, host, next) => {
    var go = true;
    var httpCode = 400;
    var _time = timestamp();
    var _timeV1 = timestampV1();
    let userSign = req.get("openweb-signature");
    let parentSign = req.get("openweb-parantSignature");
    let reqTime = req.get("openweb-requestTime");
    let reqTimeStamp = parseInt(reqTime);
    
    if((_time - reqTimeStamp) < 3600){
        if(userSign && parentSign){
            let signAddress = web3.eth.accounts.recover(reqTime, userSign);
            
            var addrSHA256 = shajs('sha256');
            addrSHA256.update(signAddress);
            addrSHA256 = addrSHA256.digest('hex');
            
            let parentAddress = web3.eth.accounts.recover(addrSHA256, parentSign);
            
            if(!_tmpDt["_usr"]){ _tmpDt["_usr"] = {}; }
            if(!_tmpDt["_usr"][parentAddress]){ _tmpDt["_usr"][parentAddress] = -1; }
            
            if(!_tmpDt["_usrCount"]){ _tmpDt["_usrCount"] = {}; }
            if(!_tmpDt["_usrCount"][parentAddress]){ 
                _tmpDt["_usrCount"][parentAddress] = {}; 
            }
            if(!_tmpDt["_usrCount"][parentAddress][_timeV1]){ 
                _tmpDt["_usrCount"][parentAddress] = {}; 
                _tmpDt["_usrCount"][parentAddress][_timeV1] = 0;
            }
            
            if(_tmpDt["_usrCount"][parentAddress][_timeV1] > userReqLimit){
                httpCode = 429;
                go = false;
            } else {
                owContract.methods.users(parentAddress).call(
                    function(error, result){
                        var _expity_time = parseInt(result.expiry_time);
                        
                        if(_expity_time == 0){ _expity_time = 1; }
                        _tmpDt["_usr"][parentAddress] = _expity_time;
                        _tmpDt["_usrCount"][parentAddress][_timeV1] = _tmpDt["_usr"][parentAddress][_timeV1] + 1;
                    }
                );

                if(
                    (_tmpDt["_usr"][parentAddress] > 0 
                    && _tmpDt["_usr"][parentAddress] < _time 
                    || _tmpDt["_usr"][parentAddress][_timeV1] > userReqLimit) 
                ){
                    httpCode = 402;
                    go = false;
                } else {
                    httpCode = 200;
                    next();
                }
            }
            
        } else {
            go = false;
        }
    } else {
        go = false;
    }
    
    if(!go){
        res.sendStatus(httpCode);
    }
};





var initHttpServer = () => {
    var app = express();
    app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(function (req, res, next) {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'openweb-parantsignature, openweb-signature, openweb-requestTime');
        
        if(_meta["wallet"]){
            var parentSign = "";
            
            if(_meta["parentHash"]){
                var _wallet = _meta["wallet"];
                var _time = timestamp().toString();
                var sign = web3.eth.accounts.sign(_time, _wallet._pkey).signature;
                parentSign = _meta["parentHash"];
                
                res.setHeader('openweb-host-signature', sign);
                res.setHeader('openweb-host-parantSignature', parentSign);
                res.setHeader('openweb-host-requestTime', _time);
            }
        }
        
        let ip = req.connection.remoteAddress;
        let url_parts = url.parse(req.url);
        let host = url_parts.host;
        let path = url_parts.path;
        
        
        if(req.method == "PUT" && !isLocalRequest(ip)){
            res.sendStatus(405);
        } else if(req.method == "POST" || req.method == "OPTIONS"){
            next();
        } else {
            
            if(_checkValidDomain(host)){
                
                if(isLocalRequest(ip)){
                    next();
                } else {
                    if( host == 'openweb.ow' ){
                        next();
                    } else {
                        _validateRequest(req, res, host, next);
                    }
                }
            } else {
                res.sendStatus(400);
            }
        }
	});
    
    
	app.get(['/', '/*'], (req, res) => {
        var url_parts = url.parse(req.url);
        let host = url_parts.host;
        let path = url_parts.path;
        
        if(isWebsitePath(host, path)){
            res.sendFile(_getWebPath(host, path));
        } else {
            res.sendStatus(404);
        }
    });
    
    app.post('/check/:domain', (req, res) => {
        let domain = req.params.domain;
        
        if(!_checkValidDomain(domain)){
            res.sendStatus(400);
        }
        
        if(isWebsite(domain)){
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    });
    
    app.post('/ping', (req, res) => {
        let totalWebsites = 0;
        if(_meta["totalwebsites"]){
            totalWebsites = _meta["totalwebsites"];
        }
        
        let dt = {
            "msg": "pong",
            "total_websites": totalWebsites
        }
        res.json(dt);
    });
    
    app.options('/ping', (req, res) => {
        let totalWebsites = 0;
        if(_meta["totalwebsites"]){
            totalWebsites = _meta["totalwebsites"];
        }
        
        let dt = {
            "msg": "pong",
            "total_websites": totalWebsites
        }
        res.json(dt);
    });
    
    app.put('/get_address', (req, res) => {
        var uAddr = "";
        if(_meta["wallet"]){
            var _wallet = _meta["wallet"];
            uAddr = _wallet._addr;
        }
        
        let dt = {
            "address": uAddr
        }
        res.json(dt);
    });
    
    app.put('/setparent_signature/:signature', (req, res) => {
        let signature = req.params.signature;
        
        if(signature != ''){
            _setMeta("parentHash", signature);
        }
        res.sendStatus(200);
    });
    
    app.put('/check/:domain', (req, res) => {
        let domain = req.params.domain;
        
        if(!_checkValidDomain(domain)){
            res.sendStatus(400);
        }
        
        owContract.methods.getDomainMeta(domain).call(
            function(error, domainMeta){
                var _time = timestamp();
                var expity_time = parseInt(domainMeta._expity_time);
                
                if(expity_time <= _time){
                    _removeData(domain);
                }
            }
        );
        res.sendStatus(200);
    });
    
    
    app.listen(host_port, () => console.log('OpenWeb Listening on port: ' + host_port));
};



function _verifyIntegrity(webIndex, domain, totalFiles, fileshash){
    var tmpDomain = "tmp."+domain; 
    var rootHash = _validateWebsite(tmpDomain, totalFiles);
    if(rootHash && rootHash == fileshash){
        printMsg("Root hash verified  ... ["+domain+"]");
        _validateWebFiles(webIndex, tmpDomain, totalFiles);
    } else {
        printMsg("Root hash verificaton failed  ... ["+domain+"]");
        _removeData(tmpDomain);
        _removeData(domain);
        _setMeta("_webprocessed", webIndex);
    }
}


function _indexWebsite(webIndex, dMeta, type){
    var domain = dMeta._name;
    var filesHash = dMeta._hash;
    var _version = parseInt(dMeta._version);
    if(filesHash.substr(0, 2) === '0x'){ filesHash = filesHash.substr(2); }
    
    var tmpDomain = "tmp."+domain; 
    var path = hostDB+"/"+tmpDomain;
    
    printMsg("Git Cloning ... ["+domain+"]");
    Git.Clone(dMeta._git, path)
    .then(function(dt) {
        storeWebsiteVersion(tmpDomain, _version);
        printMsg("Checking Website Integrity  ... ["+domain+"]");
        _verifyIntegrity(webIndex, domain, dMeta._total_files, filesHash);
    })
    .catch(function(err) {
        if(err){
            printMsg("Checking Website Integrity  ... ["+domain+"]");
            _verifyIntegrity(webIndex, domain, dMeta._total_files, filesHash);
        }
    })
}


function _checkWebsite(){
    owContract.methods.websiteUpdatesCounter().call(
        function(error, result){
            var totalWebUpdate = parseInt(result);
            
            if(totalWebUpdate > 0){
                var webGetIndex = 0;
                if(_meta["_webupdates"] || _meta["_webupdates"] == 0){
                    webGetIndex = _meta["_webupdates"] + 1;
                }
                
                if(webGetIndex < totalWebUpdate){
                    _setMeta("_webupdates", webGetIndex);
                }
            }
            
        }
    );
}

function _processWebsite(){
    var webGetIndex = 0;
    if(_meta["_webupdates"] || _meta["_webupdates"] == 0){
        webGetIndex = _meta["_webupdates"] + 1;
    }
    
    var webProcessIndex = 0;
    if(_meta["_webprocessed"] || _meta["_webprocessed"] == 0){
        webProcessIndex = _meta["_webprocessed"] + 1;
    }
    
    if(webGetIndex > webProcessIndex){
        if(!_tmpDt["_webPr"]){ _tmpDt["_webPr"] = {}; }
        
        if(!_tmpDt["_webPr"][webProcessIndex]){
            printMsg("Fethching Website Updates... ["+webProcessIndex+"]");
            
            _tmpDt["_webPr"] = {};
            _tmpDt["_webPr"][webProcessIndex] = 1;
            
            owContract.methods.websiteUpdates(webProcessIndex).call(
                function(error1, domain){
                    printMsg("Fethching Website Meta ... ["+domain+"]");
                    
                    if(!isWebsite(domain)){
                        var totalWeb = 1;
                        if(_meta["totalwebsites"]){
                            totalWeb = _meta["totalwebsites"] + 1;
                        }
                        
                        _setMeta("totalwebsites", totalWeb);
                    }

                    owContract.methods.getDomainMeta(domain).call(
                        function(error2, domainMeta){
                            var _time = timestamp();
                            var expity_time = parseInt(domainMeta._expity_time);
                            var _version = parseInt(domainMeta._version);

                            var _currVersion = _getWebsiteVersion(domain);

                            if(expity_time <= _time){
                                _removeData(domain);
                                _setMeta("_webprocessed", webProcessIndex);
                                printMsg("Domain Expired ... ["+domain+"]");
                            } else if(_currVersion < _version){
                                printMsg("Processing Website Meta ... ["+domain+"]");
                                _indexWebsite(webProcessIndex, domainMeta, "tmp");
                            }
                        }
                    );
                }
            );
        }
    }
}

function _loadLimits(){
    owContract.methods.websiteFilesLimit().call(
        function(error, dt){
            websiteFilesLimit = parseInt(dt);
        }
    );
    
    owContract.methods.websiteSizeLimit().call(
        function(error, dt){
            websiteSizeLimit = parseInt(dt);
        }
    );
}

function _initAddress(){
    if(!_meta["wallet"]){
        var addrMeata = web3.eth.accounts.create(web3.utils.randomHex(32));
        
        var _dt = {
            "_addr": addrMeata.address,
            "_pkey": addrMeata.privateKey
        };
        
        _setMeta("wallet", _dt);
    };
}


var initWorkers = () => {
    setInterval(_checkWebsite, 5*1000);
    setInterval(_processWebsite, 5*1000);
};


var _initNext = () => {
    _loadLimits();
    _initAddress();
	initHttpServer();
	initWorkers();
}

_loadConfig();
