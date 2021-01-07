/* PoolInit (Updated) */

// Import Required Modules
var fs = require("fs");
var path = require("path");
var os = require("os");
var cluster = require("cluster");
var extend = require("extend");

var async = require("async");

var Redis = require("redis");
var RedisClustr = require("redis-clustr");

// Import Pool Functionality
var PoolListener = require("./libs/listener.js");
var PoolLogger = require("./libs/logger.js");
var PoolPayments = require("./libs/payments.js");
var PoolServer = require("./libs/server.js"); // API server
var PoolWorker = require("./libs/worker.js");
//var PoolWebsite = require("./libs/website.js"); // Front-end

// Import Stratum Algorithms
var Algorithms = require("blazepool-stratum-pool/libs/algorithms.js");

// Import JSON Functionality
JSON.minify = JSON.minify || require("node-json-minify");

// Check to Ensure Config Exists
if (!fs.existsSync("config.json")) {
	console.log("config.json file does not exist. Read the installation/setup instructions.");
	return;
}

// Establish Pool Variables
var poolConfigs;
var portalConfig = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: "utf8"})));
// Check for POSIX Installation
try {
	var posix = require("posix");
	try {
		posix.setrlimit("nofile", {soft: 100000, hard: 100000});
		PoolLogger.debug("POSIX", "Connection Limit", `Raised to 100K concurrent connections, now running as non-root user: ${process.getuid()}`);
	}
	catch (e) {
		if (cluster.isMaster) {
			PoolLogger.warning("POSIX", "Connection Limit", "(Safe to ignore) Must be ran as root to increase resource limits");
		}
	}
	finally {
    // Find out which user used sudo through the environment variable
		var uid = parseInt(process.env.SUDO_UID);
		if (uid) {
			// Set our server's uid to that user
			process.setuid(uid);
			PoolLogger.debug("POSIX", "Connection Limit", `Raised to 100K concurrent connections, now running as non-root user: ${process.getuid()}`);
		}
	}
}
catch (e) {
	if (cluster.isMaster)
		PoolLogger.debug("POSIX", "Connection Limit", "(Safe to ignore) POSIX module not installed and resource (connection) limit was not raised");
}

// Establish Pool Worker Cases
if (cluster.isWorker) {
	switch (process.env.workerType) {
		case "payments":
			new PoolPayments(logger);
			break;
		case "server":
			new PoolServer(logger);
			break;
		case "worker":
			new PoolWorker(logger);
			break;
/* 		case "website":
   		new PoolWebsite(logger);
   		break;	*/
	}
	return;
}

// Generate Redis Client (Is this needed here? Function is defined in payments.js)
function getRedisClient(portalConfig) {
	var redisConfig = portalConfig.redis;
	var redisClient;
	if (redisConfig.cluster) {
		if (redisConfig.password !== "") {
			redisClient = new RedisClustr({
				servers: [
					{
						host: redisConfig.host,
						port: redisConfig.port,
					},
				],
				createClient: function (port, host, options) {
					return Redis.createClient({
						port: port,
						host: host,
						password: options.password,
					});
				},
				redisOptions: {
					password: redisConfig.password,
				},
			});
		} else {
			redisClient = new RedisClustr({
				servers: [
					{
						host: redisConfig.host,
						port: redisConfig.port,
					},
				],
				createClient: function (port, host) {
					return Redis.createClient({
						port: port,
						host: host,
					});
				},
			});
		}
	} else {
		if (redisConfig.password !== "") {
			redisClient = Redis.createClient({
				port: redisConfig.port,
				host: redisConfig.host,
				password: redisConfig.password,
			});
		} else {
			redisClient = Redis.createClient({
				port: redisConfig.port,
				host: redisConfig.host,
			});
		}
	}
	return redisClient;
}

// Read and Combine ALL Pool Configurations
function buildPoolConfigs() {
	var configs = {};
	var configDir = "./pool-configs/";
	var poolConfigFiles = [];

	// Get FileNames of Pool Configurations
	fs.readdirSync(configDir).forEach(function (file) {
		if (!fs.existsSync(configDir + file) || path.extname(configDir + file) !== ".json") return;
		var poolOptions = JSON.parse(JSON.minify(fs.readFileSync(configDir + file, {encoding: "utf8"})));
		if (!poolOptions.enabled) return;
		poolOptions.fileName = file;
		poolConfigFiles.push(poolOptions);
	});

	// Ensure No Overlap in Pool Ports
	for (var i = 0; i < poolConfigFiles.length; i++) {
		var ports = Object.keys(poolConfigFiles[i].ports);
		for (var f = 0; f < poolConfigFiles.length; f++) {
			if (f === i) continue;
			var portsF = Object.keys(poolConfigFiles[f].ports);
			for (var g = 0; g < portsF.length; g++) {
				if (ports.indexOf(portsF[g]) !== -1) {
					PoolLogger.error("Master", poolConfigFiles[f].fileName, `Has same configured port of ${portsF[g]} as ${poolConfigFiles[i].fileName}`);
					process.exit(1);
					return;
				}
			}
		}
	}

	// Iterate Through Each Configuration File
	poolConfigFiles.forEach(function (poolOptions) {
		// Establish Mainnet/Testnet
		if (poolOptions.coin.mainnet) {
			poolOptions.coin.mainnet.bip32.public = Buffer.from(poolOptions.coin.mainnet.bip32.public, "hex").readUInt32LE(0);
			poolOptions.coin.mainnet.pubKeyHash = Buffer.from(poolOptions.coin.mainnet.pubKeyHash, "hex").readUInt8(0);
			poolOptions.coin.mainnet.scriptHash = Buffer.from(poolOptions.coin.mainnet.scriptHash, "hex").readUInt8(0);
		}
		if (poolOptions.coin.testnet) {
			poolOptions.coin.testnet.bip32.public = Buffer.from(poolOptions.coin.testnet.bip32.public, "hex").readUInt32LE(0);
			poolOptions.coin.testnet.pubKeyHash = Buffer.from(poolOptions.coin.testnet.pubKeyHash, "hex").readUInt8(0);
			poolOptions.coin.testnet.scriptHash = Buffer.from(poolOptions.coin.testnet.scriptHash, "hex").readUInt8(0);
		}

		// Load Configuration from File
		for (var option in portalConfig.defaultPoolConfigs) {
			if (!(option in poolOptions)) {
				var toCloneOption = portalConfig.defaultPoolConfigs[option];
				var clonedOption = {};
				if (toCloneOption.constructor === Object) {
					extend(true, clonedOption, toCloneOption);
				}
				else {
					clonedOption = toCloneOption;
				}
				poolOptions[option] = clonedOption;
			}
		}
		configs[poolOptions.coin.name] = poolOptions;

		// Check to Ensure Algorithm is Supported
		if (!(poolOptions.coin.algorithm in Algorithms)) {
			PoolLogger.error("Master", poolOptions.coin.name, `Cannot run a pool for unsupported algorithm "${poolOptions.coin.algorithm}"`);
			delete configs[poolOptions.coin.name];
		}
	});
	return configs;
}

// Functionality for Pool Listener
function startPoolListener() {
	// Establish Listener Variables
	var cliPort = portalConfig.cliPort;
	var listener = new PoolListener(cliPort);

	// Establish Listener Log
	listener.on("log", function (text) {
			PoolLogger.debug("Master", "CLI", text);

			// Establish Listener Commands
		})
		.on("command", function (command, params, options, reply) {
			switch (command) {
				case "reloadpool":
					Object.keys(cluster.workers).forEach(function (id) {
						cluster.workers[id].send({type: "reloadpool", coin: params[0]});
					});
					reply(`Reloaded Pool ${params[0]}`);
					break;
				case "blocknotify":
					Object.keys(cluster.workers).forEach(function (id) {
						cluster.workers[id].send({type: "blocknotify", coin: params[0], hash: params[1]});
					});
					reply("Pool workers notified");
					break;
				default:
					reply(`Unrecognized command: "${command}"`);
					break;
			}
		})
		.start();
}

// Functionality for Pool Workers
function startPoolWorkers() {

	// Check if No Configurations Exist
	if (Object.keys(poolConfigs).length === 0) {
		PoolLogger.warning("Master", "Workers", "No pool configs exist or are enabled in configs folder. No pools started.");
		return;
	}

	// Check if Daemons Configured
	//var connection;
	//var redisConfig = portalConfig.redis;
	Object.keys(poolConfigs).forEach(function (coin) {
		var p = poolConfigs[coin];
		if (!Array.isArray(p.daemons) || p.daemons.length < 1) {
			PoolLogger.error("Master", coin, "No daemons configured so a pool cannot be started for this coin.");
			delete poolConfigs[coin];
		}
		//else if (!connection) {
		//	connection = getRedisClient(portalConfig);
		//	connection.on("ready", function () {
		//		PoolLogger.debug("Master", coin, `Processing setup with Redis (${redisConfig.host}:${redisConfig.port})`);
		//	});
		//}
	});

	// Establish Forking/Clustering
	var serializedConfigs = JSON.stringify(poolConfigs);
	var numForks = (function () {
		if (!portalConfig.clustering || !portalConfig.clustering.enabled) {
			return 1;
		}
		if (portalConfig.clustering.forks === "auto") {
			return os.cpus().length;
		}
		if (!portalConfig.clustering.forks || isNaN(portalConfig.clustering.forks)) {
			return 1;
		}
		return portalConfig.clustering.forks;
	})();

	// Establish Pool Workers
	var poolWorkers = {};
	var createPoolWorker = function (forkId) {
		var worker = cluster.fork({
			workerType: "worker",
			forkId: forkId,
			pools: serializedConfigs,
			portalConfig: JSON.stringify(portalConfig)
		});
		worker.forkId = forkId;
		worker.type = "worker";
		poolWorkers[forkId] = worker;

		worker.on("exit", function (code, signal) {
				PoolLogger.error("Master", "Workers", `Fork ${forkId} died, starting replacement worker...`);
				setTimeout(function () {
					createPoolWorker(forkId);
				}, 2000);
			})
			.on("message", function (msg) {
				switch (msg.type) {
					case "banIP":
						Object.keys(cluster.workers).forEach(function (id) {
							if (cluster.workers[id].type === "worker") {
								cluster.workers[id].send({type: "banIP", ip: msg.ip});
							}
						});
						break;
				}
			});
	};

	// Create Pool Workers
	var i = 0;
	var startInterval = setInterval(function () {
		createPoolWorker(i);
		i++;
		if (i === numForks) {
			clearInterval(startInterval);
			PoolLogger.debug("Master", "Workers", `Started ${Object.keys(poolConfigs).length} pool(s) on ${numForks} thread(s)`);
		}
	}, 250);
}

// Functionality for Pool Payments
function startPoolPayments() {
	// Check if Pool Enabled Payments
	var enabledForAny = false;
	for (var pool in poolConfigs) {
		var p = poolConfigs[pool];
		var enabled = p.enabled && p.paymentProcessing && p.paymentProcessing.enabled;
		if (enabled) {
			enabledForAny = true;
			break;
		}
	}

	// Return if No One Needs Payments
	if (!enabledForAny) return;

	// Establish Pool Payments
	var worker = cluster.fork({
		workerType: "payments",
		pools: JSON.stringify(poolConfigs),
		portalConfig: JSON.stringify(portalConfig),
	});
	worker.on("exit", function (code, signal) {
		PoolLogger.error("Master", "Payments", "Payment process died, starting replacement...");
		setTimeout(function () {
			startPoolPayments();
		}, 2000);
	});
}

function startPoolServer() {
	var worker = cluster.fork({
		workerType: "server",
		pools: JSON.stringify(poolConfigs),
		portalConfig: JSON.stringify(portalConfig),
	});

	worker.on("exit", function (code, signal) {
		PoolLogger.error("Master", "Server", "Server process died, starting replacement...");
		setTimeout(function () {
			startPoolServer();
		}, 2000);
	});
}


/* Website front-end from original NOMP code

var startPoolWebsite = function(){

	if (!portalConfig.website.enabled) return;

	var worker = cluster.fork({
		workerType: "website",
		pools: JSON.stringify(poolConfigs),
		portalConfig: JSON.stringify(portalConfig)
	});
	worker.on("exit", function(code, signal){
		PoolLogger.error("Master", "Website", "Website process died, spawning replacement...");
		setTimeout(function(){
			startWebsite(portalConfig, poolConfigs);
		}, 2000);
	});
};

*/

// Initialize Server
var PoolInit = (function () {
	// Build Configurations
	poolConfigs = buildPoolConfigs();

	// Start Pool Workers
	startPoolListener();
	startPoolWorkers();
	startPoolPayments();
	startPoolServer();
	//startPoolWebsite();
})();
