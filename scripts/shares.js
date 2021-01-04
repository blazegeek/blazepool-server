/*
 *
 * PoolShares (Updated)
 *
 */

// Import Required Modules
var redis = require("redis");
var RedisClustr = require("redis-clustr");

// Round to # of Digits Given
function roundTo(n, digits) {
    if (digits === undefined) {
        digits = 0;
    }
    var multiplicator = Math.pow(10, digits);
    n = parseFloat((n * multiplicator).toFixed(11));
    var test =(Math.round(n) / multiplicator);
    return +(test.toFixed(digits));
}

// Generate Redis Client
function getRedisClient(portalConfig) {
    var redisConfig = portalConfig.redis;
    var redisClient;
    if (redisConfig.cluster) {
        if (redisConfig.password !== "") {
            redisClient = new RedisClustr({
                servers: [{
                    host: redisConfig.host,
                    port: redisConfig.port,
                }],
                createClient: function(port, host, options) {
                    return redis.createClient({
                        port: port,
                        host: host,
                        password: options.password,
                    });
                },
                redisOptions: {
                    password: redisConfig.password
                }
            });
        }
        else {
            redisClient = new RedisClustr({
                servers: [{
                    host: redisConfig.host,
                    port: redisConfig.port,
                }],
                createClient: function(port, host) {
                    return redis.createClient({
                        port: port,
                        host: host,
                    });
                },
            });
        }
    }
    else {
        if (redisConfig.password !== "") {
            redisClient = redis.createClient({
                port: redisConfig.port,
                host: redisConfig.host,
                password: redisConfig.password
            });
        }
        else {
            redisClient = redis.createClient({
                port: redisConfig.port,
                host: redisConfig.host,
            });
        }
    }
    return redisClient;
}

// Pool Payments Main Function
/* eslint no-unused-vars: ["error", { "args": "none" }] */
var PoolShares = function (logger, poolConfig, portalConfig) {

    // Establish Shares Variables
    var coin = poolConfig.coin.name;
    var forkId = process.env.forkId;

    // Establish Log Variables
    var logSystem = "Pool";
    var logComponent = coin;
    var logSubCat = `Thread ${  parseInt(forkId) + 1}`;

    // Establish Redis Client
    var redisClient = getRedisClient(portalConfig);

    // Manage Ready Endpoint
    redisClient.on("ready", function() {
        logger.debug(logSystem, logComponent, logSubCat, `Share processing setup with redis (${  redisConfig.host
            }:${  redisConfig.port   })`);
    });

    // Manage Error Endpoint
    redisClient.on("error", function(error) {
        logger.error(logSystem, logComponent, logSubCat, `Redis client had an error: ${  JSON.stringify(error)}`);
    });

    // Manage End Endpoint
    redisClient.on("end", function() {
        logger.error(logSystem, logComponent, logSubCat, "Connection to redis database has been ended");
    });

    // Manage Information Endpoint
    redisClient.info(function(error, response) {
        if (error) {
            logger.error(logSystem, logComponent, logSubCat, "Redis version check failed");
            return;
        }
        var parts = response.split("\r\n");
        var version;
        var versionString;
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].indexOf(":") !== -1) {
                var valParts = parts[i].split(":");
                if (valParts[0] === "redis_version") {
                    versionString = valParts[1];
                    version = parseFloat(versionString);
                    break;
                }
            }
        }

        // Check if Version is Unidentified
        if (!version) {
            logger.error(logSystem, logComponent, logSubCat, "Could not detect redis version - but be super old or broken");
        }

        // Check if Version < 2.6
        else if (version < 2.6) {
            logger.error(logSystem, logComponent, logSubCat, `You"re using redis version ${  versionString  } the minimum required version is 2.6. Follow the damn usage instructions...`);
        }

    });

    // Manage Individual Shares
    this.handleShare = function(isValidShare, isValidBlock, shareData) {

        // Check to see if Solo Mining
        var isSoloMining = false;
        if (typeof poolConfig.ports[shareData.port] !== "undefined") {
            if (poolConfig.ports[shareData.port].soloMining) {
                isSoloMining = true;
            }
        }

        // Establish Redis Variables
        var dateNow = Date.now();
        var redisCommands = [];
        var shareLookups = [
            ["hgetall", `${coin  }:times:timesStart`],
            ["hgetall", `${coin  }:times:timesShare`],
            ["hgetall", `${coin  }:shares:roundCurrent`],
            ["hgetall", `${coin  }:times:timesCurrent`]
        ];

        // Get Current Start/Share Times
        redisClient.multi(shareLookups).exec(function(error, results) {
            if (error) {
                logger.error(logSystem, logComponent, `Could not get time data from database: ${  JSON.stringify(error)}`);
                return;
            }

            // Establish Current Values
            var currentShares = results[2] || {};
            var currentTimes = results[3] || {};

            // Handle Valid Share
            if (isValidShare) {

                var lastStartTimes = results[0] || {};
                var lastShareTimes = results[1] || {};
                var lastShareTime = dateNow;
                var lastStartTime = dateNow;

                var workerAddress = shareData.worker;
                var combinedShare = {
                    time: dateNow,
                    worker: workerAddress,
                    soloMined: isSoloMining,
                };

                // Check Regarding Worker Join Time
                if (!lastStartTimes[workerAddress] || !lastStartTimes[workerAddress]) {
                    lastShareTimes[workerAddress] = dateNow;
                    lastStartTimes[workerAddress] = dateNow;
                }
                if (lastShareTimes[workerAddress] !== null && lastShareTimes[workerAddress] > 0) {
                    lastShareTime = lastShareTimes[workerAddress];
                    lastStartTime = lastStartTimes[workerAddress];
                }

                // Check Regarding Continuous Mining
                var timeChangeSec = roundTo(Math.max(dateNow - lastShareTime, 0) / 1000, 4);

                // Add New Data to Round Times
                if (timeChangeSec < 900) {
                    redisCommands.push(["hincrbyfloat", `${coin  }:times:timesCurrent`, workerAddress, timeChangeSec]);
                }

                // Update Current Round Shares/Times
                currentShares[JSON.stringify(combinedShare)] = shareData.difficulty;
                currentTimes[workerAddress] = timeChangeSec;

                // Check to Ensure Block Not Found
                if (!isValidBlock) {
                    redisCommands.push(["hset", `${coin  }:times:timesStart`, workerAddress, lastStartTime]);
                    redisCommands.push(["hset", `${coin  }:times:timesShare`, workerAddress, lastShareTime]);
                }

                // Handle Redis Updates
                redisCommands.push(["hincrby", `${coin  }:shares:roundCurrent`, JSON.stringify(combinedShare), shareData.difficulty]);
                redisCommands.push(["hincrby", `${coin  }:statistics:basic`, "validShares", 1]);
            }
            else {
                redisCommands.push(["hincrby", `${coin  }:statistics:basic`, "invalidShares", 1]);
            }

            // Push Block Data to Main Array
            if (isValidBlock) {

                var blockData = {
                    time: dateNow,
                    height: shareData.height,
                    blockHash: shareData.blockHash,
                    blockReward: shareData.blockReward,
                    txHash: shareData.txHash,
                    difficulty: difficulty,
                    worker: shareData.worker,
                    soloMined: isSoloMining,
                };

                // Handle Redis Deletions
                redisCommands.push(["del", `${coin  }:times:timesStart`]);
                redisCommands.push(["del", `${coin  }:times:timesShare`]);

                // Handle Redis Shares/Times Updates
                if (redisConfig.cluster) {
                    redisCommands.push(["del", `${coin  }:shares:roundCurrent`]);
                    redisCommands.push(["del", `${coin  }:times:timesCurrent`]);
                    for (var share in currentShares) {
                        redisCommands.push(["hset", `${coin  }:shares:round${  shareData.height}`, share, currentShares[share]]);
                    }
                    for (var worker in currentTimes) {
                        redisCommands.push(["hset", `${coin  }:times:times${  shareData.height}`, worker, currentTimes[worker]]);
                    }
                }
                else {
                    redisCommands.push(["rename", `${coin  }:shares:roundCurrent`, `${coin  }:shares:round${  shareData.height}`]);
                    redisCommands.push(["rename", `${coin  }:times:timesCurrent`, `${coin  }:times:times${  shareData.height}`]);
                }

                // Handle Redis Updates
                redisCommands.push(["sadd", `${coin  }:blocks:pending`, JSON.stringify(blockData)]);
                redisCommands.push(["hincrby", `${coin  }:statistics:basic`, "validBlocks", 1]);
            }
            else if (shareData.blockHash) {
                redisCommands.push(["hincrby", `${coin  }:statistics:basic`, "invalidBlocks", 1]);
            }

            // Push Hashrate Data to Database
            var difficulty = (isValidShare ? shareData.difficulty : -shareData.difficulty);
            var hashrateData = {
                time: dateNow,
                difficulty: difficulty,
                worker: shareData.worker,
                soloMined: isSoloMining,
            };
            redisCommands.push(["zadd", `${coin  }:statistics:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateData)]);

            // Write Share Information to Redis Database
            redisClient.multi(redisCommands).exec(function(error, replies) {
                if (error) {
                    logger.error(logSystem, logComponent, logSubCat, `Error with share processor multi ${  JSON.stringify(error)}`);
                }
            });
        });
    };
};

// Export Pool Shares
module.exports = PoolShares;
