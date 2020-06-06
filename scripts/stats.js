/*
 *
 * PoolStats (Updated)
 *
 */

// Import Required Modules
var zlib = require('zlib');
var redis = require('redis');
var async = require('async');
var os = require('os');

// Import Stratum Algorithms
var algos = require('stratum-pool/lib/algoProperties.js');

// Create Client Given Redis Info
function createClient(port, host, pass) {
    var redisClient = redis.createClient(port, host);
    if (pass) {
        redisClient.auth(pass);
    }
    return client;
}

// Sort Object Properties Given Info
function sortProperties(obj, sortedBy, isNumericSort, reverse) {
    sortedBy = sortedBy || 1;
    isNumericSort = isNumericSort || false;
    reverse = reverse || false;
    var reversed = (reverse) ? -1 : 1;
    var sortable = [];
  	for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
  	        sortable.push([key, obj[key]]);
  		  }
  	}
  	if (isNumericSort) {
        sortable.sort(function (a, b) {
    			return reversed * (a[1][sortedBy] - b[1][sortedBy]);
    		});
    }
  	else {
        sortable.sort(function (a, b) {
          var x = a[1][sortedBy].toLowerCase(),
            y = b[1][sortedBy].toLowerCase();
          return x < y ? reversed * -1 : x > y ? reversed : 0;
        });
    }
  	return sortable;
}

// Pool Stats Main Function
var PoolStats = function (logger, portalConfig, poolConfigs) {

    // Establsh Helper Variables
    var _this = this;
    var redisClients = [];
    var redisStats;

    // Establish Log Variables
    var logSystem = 'Stats';

    // Establish Stat Variables
    this.statHistory = [];
    this.statPoolHistory = [];
    this.stats = {};
    this.statsString = '';

    // Gather Stats from Database
    var canDoStats = true;
    setupStatsRedis();
    gatherStatHistory();

    // Iterate Through Each Coin File
    Object.keys(poolConfigs).forEach(function(coin) {

        // Check to Ensure Stats are Active
        if (!canDoStats) return;
        var poolConfig = poolConfigs[coin];
        var redisConfig = poolConfig.redis;

        // Push Configurations to Each Redis Client
        for (var i = 0; i < redisClients.length; i++) {
            var client = redisClients[i];
            if (client.client.port === redisConfig.port && client.client.host === redisConfig.host) {
                client.coins.push(coin);
                return;
            }
        }
        redisClients.push({
            coins: [coin],
            client: redis.createClient(redisConfig.port, redisConfig.host)
        });
    });

    var magnitude = 100000000;
    var coinPrecision = magnitude.toString().length - 1;

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

    // Convert Satoshis to Coins
    var satoshisToCoins = function(satoshis) {
        return roundTo((satoshis / magnitude), coinPrecision);
    };

    // Convert Coins to Satoshis
    var coinsToSatoshies = function(coins) {
        return Math.round(coins * magnitude);
    };

    // Round Coins to Nearest Value Given Precision
    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    // Convert Seconds to Readable String
    function readableSeconds(t) {
        var seconds = Math.round(t);
        var minutes = Math.floor(seconds/60);
        var hours = Math.floor(minutes/60);
        var days = Math.floor(hours/24);
        hours = hours-(days*24);
        minutes = minutes-(days*24*60)-(hours*60);
        seconds = seconds-(days*24*60*60)-(hours*60*60)-(minutes*60);
        if (days > 0) { return (days + "d " + hours + "h " + minutes + "m " + seconds + "s"); }
        if (hours > 0) { return (hours + "h " + minutes + "m " + seconds + "s"); }
        if (minutes > 0) {return (minutes + "m " + seconds + "s"); }
        return (seconds + "s");
    }

    // Get List of Coins by Client
    this.getCoins = function(callback) {
        _this.stats.coins = redisClients[0].coins;
        callback();
    };

    // Get Current Payout Given Client Address
    this.getPayout = function(address, callback) {
        async.waterfall([
            function(callback2) {
                _this.getBalanceByAddress(address, function() {
                    callback2(null, 'test');
                });
            }
        ], function(err, total) {
            callback(coinsRound(total).toFixed(8));
        });
    };

    // Get Block History
    this.getBlocks = function (callback) {
        var allBlocks = {};
        async.each(_this.stats.pools, function(pool, pcb) {
            if (_this.stats.pools[pool.name].pending && _this.stats.pools[pool.name].pending.blocks)
                for (var i=0; i<_this.stats.pools[pool.name].pending.blocks.length; i++)
                    allBlocks[pool.name+"-"+_this.stats.pools[pool.name].pending.blocks[i].split(':')[2]] = _this.stats.pools[pool.name].pending.blocks[i];
            if (_this.stats.pools[pool.name].confirmed && _this.stats.pools[pool.name].confirmed.blocks)
                for (var i=0; i<_this.stats.pools[pool.name].confirmed.blocks.length; i++)
                    allBlocks[pool.name+"-"+_this.stats.pools[pool.name].confirmed.blocks[i].split(':')[2]] = _this.stats.pools[pool.name].confirmed.blocks[i];
            pcb();
        }, function(err) {
            callback(allBlocks);
        });
    }

    this.getTotalSharesByAddress = function(address, callback) {
        var a = address.split(".")[0];
        var client = redisClients[0].client,
        coins = redisClients[0].coins,
        shares = [];

        var pindex = parseInt(0);
  		  var totalShares = parseFloat(0);
  		  async.each(_this.stats.pools, function(pool, pcb) {
            pindex++;
  			    var coin = String(_this.stats.pools[pool.name].name);
  			    client.hscan(coin + ':shares:roundCurrent', 0, "match", a+"*", "count", 1000, function(err, result) {
                if (err) {
                    pcb(err);
                    return;
                }
        				var workerName="";
        				var shares = 0;
        				for (var i in result[1]) {
          					if (Math.abs(i % 2) != 1) {
            						workerName = String(result[1][i]);
          					}
                    else {
            						shares += parseFloat(result[1][i]);
          					}
          			}
                if (shares > 0) {
                    totalShares = shares;
                }
                pcb();
  			    });
  		  }, function(err) {
            if (err) {
                callback(0);
                return;
            }
            if (totalShares > 0 || (pindex >= Object.keys(_this.stats.pools).length)) {
                callback(totalShares);
                return;
            }
    		});
  	};

    this.getBalanceByAddress = function(address, callback) {
  	    var a = address.split(".")[0];
        var client = redisClients[0].client,
        coins = redisClients[0].coins,
        balances = [];

        var totalHeld = parseFloat(0);
        var totalPaid = parseFloat(0);
        var totalImmature = parseFloat(0);

        async.each(_this.stats.pools, function(pool, pcb) {
            var coin = String(_this.stats.pools[pool.name].name);
			      client.hscan(coin + ':immature', 0, "match", a+"*", "count", 10000, function(error, pends) {
                client.hscan(coin + ':balances', 0, "match", a+"*", "count", 10000, function(error, bals) {
                    client.hscan(coin + ':payouts', 0, "match", a+"*", "count", 10000, function(error, pays) {

                        var workerName = "";
                        var balAmount = 0;
                        var paidAmount = 0;
                        var pendingAmount = 0;
                        var workers = {};

                        for (var i in pays[1]) {
                            if (Math.abs(i % 2) != 1) {
                                workerName = String(pays[1][i]);
                                workers[workerName] = (workers[workerName] || {});
                            }
                            else {
                                paidAmount = parseFloat(pays[1][i]);
                                workers[workerName].paid = coinsRound(paidAmount);
                                totalPaid += paidAmount;
                            }
                        }

                        for (var b in bals[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(bals[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            }
                            else {
                                balAmount = parseFloat(bals[1][b]);
                                workers[workerName].balance = coinsRound(balAmount);
                                totalHeld += balAmount;
                            }
                        }

                        for (var b in pends[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(pends[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            }
                            else {
                                pendingAmount = parseFloat(pends[1][b]);
                                workers[workerName].immature = coinsRound(pendingAmount);
                                totalImmature += pendingAmount;
                            }
                        }

                        for (var w in workers) {
                            balances.push({
                                worker: String(w),
                                balance: workers[w].balance,
                                paid: workers[w].paid,
                                immature: workers[w].immature
                            });
                        }
                        pcb();
                    });
                });
            });
        }, function(err) {
            if (err) {
                callback("There was an error getting balances");
                return;
            }
            _this.stats.balances = balances;
            _this.stats.address = address;
            callback({
                totalHeld: coinsRound(totalHeld),
                totalPaid: coinsRound(totalPaid),
                totalImmature: satoshisToCoins(totalImmature),
                balances: balances
            });
        });
    };

    // Connect to Redis Database
    function setupStatsRedis() {
        redisStats = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
        redisStats.on('error', function(err) {
            logger.error(logSystem, 'Historics', 'Redis for stats had an error ' + JSON.stringify(err));
        });
    }

    // Sort All Pools
    function sortPools(objects) {
    		var newObject = {};
    		var sortedArray = sortProperties(objects, 'name', false, false);
    		for (var i = 0; i < sortedArray.length; i++) {
    			var key = sortedArray[i][0];
    			var value = sortedArray[i][1];
    			newObject[key] = value;
    		}
    		return newObject;
    }

    // Sort All Blocks
    function sortBlocks(a, b) {
        var as = parseInt(a.split(":")[2]);
        var bs = parseInt(b.split(":")[2]);
        if (as > bs) return -1;
        if (as < bs) return 1;
        return 0;
    }

    // Sort All Workers by Name
    function sortWorkersByName(objects) {
        var newObject = {};
        var sortedArray = sortProperties(objects, 'name', false, false);
        for (var i = 0; i < sortedArray.length; i++) {
            var key = sortedArray[i][0];
            var value = sortedArray[i][1];
            newObject[key] = value;
        }
        return newObject;
    }

    // Sort All Workers by HashRate
    function sortWorkersByHashrate(a, b) {
        if (a.hashrate === b.hashrate) {
            return 0;
        }
        else {
            return (a.hashrate < b.hashrate) ? -1 : 1;
        }
    }

    // Sort All Miners by HashRate
    function sortMinersByHashrate(objects) {
        var newObject = {};
        var sortedArray = sortProperties(objects, 'shares', true, true);
        for (var i = 0; i < sortedArray.length; i++) {
            var key = sortedArray[i][0];
            var value = sortedArray[i][1];
            newObject[key] = value;
        }
        return newObject;
    }

    // Get Stat History
    function gatherStatHistory() {
        var retentionTime = (((Date.now() / 1000) - portalConfig.stats.historicalRetention) | 0).toString();
        logger.debug(logSystem, 'History', 'Gathering statistics for website API');
        redisStats.zrangebyscore(['statHistory', retentionTime, '+inf'], function(err, replies) {
            if (err) {
                logger.error(logSystem, 'Historics', 'Error when trying to grab historical stats ' + JSON.stringify(err));
                return;
            }
            for (var i = 0; i < replies.length; i++) {
                _this.statHistory.push(JSON.parse(replies[i]));
            }
            _this.statHistory = _this.statHistory.sort(function(a, b) {
                return a.time - b.time;
            });
            _this.statHistory.forEach(function(stats) {
                addStatPoolHistory(stats);
            });
        });
    }

    // Append to Stat History
    function addStatPoolHistory(stats) {
        var data = {
            time: stats.time,
            pools: {}
        };
        for (var pool in stats.pools) {
            data.pools[pool] = {
                hashrate: stats.pools[pool].hashrate,
                workerCount: stats.pools[pool].workerCount,
                blocks: stats.pools[pool].blocks
            }
        }
        _this.statPoolHistory.push(data);
    }

    // Convert Hashrate into Readable String
    this.getReadableHashRateString = function(hashrate) {
        var i = -1;
        var byteUnits = [ ' KH', ' MH', ' GH', ' TH', ' PH', ' EH' ];
        do {
            hashrate = hashrate / 1000;
            i++;
        } while (hashrate > 1000);
        return hashrate.toFixed(2) + byteUnits[i];
    };

    // Get ALL Stats from Pool/Database
    this.getGlobalStats = function(callback) {

        var allCoinStats = {};
        var statGatherTime = Date.now() / 1000 | 0;

        async.each(redisClients, function(client, callback) {

            // Establish Redis Variables
            var windowTime = (((Date.now() / 1000) - portalConfig.stats.hashrateWindow) | 0).toString();
            var redisCommands = [];
            var redisCommandTemplates = [
                ['zremrangebyscore', ':hashrate', '-inf', '(' + windowTime],
                ['zrangebyscore', ':hashrate', windowTime, '+inf'],
                ['hgetall', ':stats'],
                ['scard', ':blocksPending'],
                ['scard', ':blocksConfirmed'],
                ['scard', ':blocksKicked'],
                ['smembers', ':blocksPending'],
                ['smembers', ':blocksConfirmed'],
                ['hgetall', ':shares:roundCurrent'],
                ['hgetall', ':blocksPendingConfirms'],
                ['zrange', ':payments', -100, -1],
                ['hgetall', ':shares:timesCurrent']
            ];

            // Get Templates for Each Coin
            var commandsPerCoin = redisCommandTemplates.length;
            client.coins.map(function(coin) {
                redisCommandTemplates.map(function(t) {
                    var clonedTemplates = t.slice(0);
                    clonedTemplates[1] = coin + clonedTemplates[1];
                    redisCommands.push(clonedTemplates);
                });
            });

            // Get Global Statistics for Each Coin
            client.client.multi(redisCommands).exec(function(err, replies) {
                if (err) {
                    logger.error(logSystem, 'Global', 'error with getting global stats ' + JSON.stringify(err));
                    callback(err);
                }
                else {
                    for (var i = 0; i < replies.length; i += commandsPerCoin) {
                        var coinName = client.coins[i / commandsPerCoin | 0];
                        var coinStats = {
                            name: coinName,
                            symbol: poolConfigs[coinName].coin.symbol.toUpperCase(),
                            algorithm: poolConfigs[coinName].coin.algorithm,
                            hashrates: replies[i + 1],
                            poolStats: {
                                validShares: replies[i + 2] ? (replies[i + 2].validShares || 0) : 0,
                                validBlocks: replies[i + 2] ? (replies[i + 2].validBlocks || 0) : 0,
                                invalidShares: replies[i + 2] ? (replies[i + 2].invalidShares || 0) : 0,
                                totalPaid: replies[i + 2] ? (replies[i + 2].totalPaid || 0) : 0
                            },
                            blocks: {
                                pending: replies[i + 3],
                                confirmed: replies[i + 4],
                                orphaned: replies[i + 5]
                            },
                            pending: {
                                blocks: replies[i + 6].sort(sortBlocks),
                                confirms: (replies[i + 9] || {})
                            },
                            confirmed: {
                                blocks: replies[i + 7].sort(sortBlocks).slice(0,50)
                            },
                            payments: [],
                            currentRoundShares: (replies[i + 8] || {}),
                            currentRoundTimes: (replies[i + 11] || {}),
                            maxRoundTime: 0,
                            shareCount: 0
                        };
                        for(var j = replies[i + 10].length; j > 0; j--){
                            var jsonObj;
                            try {
                                jsonObj = JSON.parse(replies[i + 10][j-1]);
                            }
                            catch(e) {
                                jsonObj = null;
                            }
                            if (jsonObj !== null) {
                                coinStats.payments.push(jsonObj);
                            }
                        }
                        allCoinStats[coinStats.name] = (coinStats);
                    }
                    allCoinStats = sortPools(allCoinStats);
                    callback();
                }
            });
        }, function(err) {

            // Handle Errors
            if (err) {
                logger.error(logSystem, 'Global', 'error getting all stats' + JSON.stringify(err));
                callback();
                return;
            }

            // Establish Client Statistics
            var portalStats = {
                time: statGatherTime,
                global:{
                    workers: 0,
                    hashrate: 0
                },
                algos: {},
                pools: allCoinStats
            };

            // Get Client Statistics for Each Coin
            Object.keys(allCoinStats).forEach(function(coin) {

                var coinStats = allCoinStats[coin];
                coinStats.workers = {};
                coinStats.miners = {};
                coinStats.shares = 0;
                coinStats.hashrates.forEach(function(ins) {
                    var parts = ins.split(':');
                    var workerShares = parseFloat(parts[0]);
                    var miner = parts[1].split('.')[0];
                    var worker = parts[1];
                    var diff = Math.round(parts[0] * 8192);
                    if (workerShares > 0) {
                        coinStats.shares += workerShares;
                        if (worker in coinStats.workers) {
                            coinStats.workers[worker].shares += workerShares;
                            coinStats.workers[worker].diff = diff;
                        }
                        else {
                            coinStats.workers[worker] = {
                                name: worker,
                                diff: diff,
                                shares: workerShares,
                                invalidshares: 0,
                                currRoundShares: 0,
                                currRoundTime: 0,
                                hashrate: null,
                                hashrateString: null,
                                luckDays: null,
                                luckHours: null,
                                paid: 0,
                                balance: 0
                            };
                        }
                        if (miner in coinStats.miners) {
                            coinStats.miners[miner].shares += workerShares;
                        }
                        else {
                            coinStats.miners[miner] = {
                                name: miner,
                                shares: workerShares,
                                invalidshares: 0,
                                currRoundShares: 0,
                                currRoundTime: 0,
                                hashrate: null,
                                hashrateString: null,
                                luckDays: null,
                                luckHours: null
                            };
                        }
                    }
                    else {
                        if (worker in coinStats.workers) {
                            coinStats.workers[worker].invalidshares -= workerShares; // workerShares is negative number!
                            coinStats.workers[worker].diff = diff;
                        }
                        else {
                            coinStats.workers[worker] = {
                                name: worker,
                                diff: diff,
                                shares: 0,
                                invalidshares: -workerShares,
                                currRoundShares: 0,
                                currRoundTime: 0,
                                hashrate: null,
                                hashrateString: null,
                                luckDays: null,
                                luckHours: null,
                                paid: 0,
                                balance: 0
                            };
                        }
                        if (miner in coinStats.miners) {
                            coinStats.miners[miner].invalidshares -= workerShares;
                        }
                        else {
                            coinStats.miners[miner] = {
                                name: miner,
                                shares: 0,
                                invalidshares: -workerShares,
                                currRoundShares: 0,
                                currRoundTime: 0,
                                hashrate: null,
                                hashrateString: null,
                                luckDays: null,
                                luckHours: null,
                            };
                        }
                    }
                });

                // Sort Miners by HashRate
                coinStats.miners = sortMinersByHashrate(coinStats.miners);

                // Finalize Client Statistics for Coins
                var shareMultiplier = Math.pow(2, 32) / algos[coinStats.algorithm].multiplier;
                coinStats.hashrate = shareMultiplier * coinStats.shares / portalConfig.stats.hashrateWindow;
                coinStats.hashrateString = _this.getReadableHashRateString(coinStats.hashrate);

                var _blocktime = 160;
                var _shareTotal = parseFloat(0);
                var _maxTimeShare = parseFloat(0);
                var _networkHashRate = parseFloat(coinStats.poolStats.networkSols) * 1.2;
                var _myHashRate = (coinStats.hashrate / 1000000) * 2;

                coinStats.luckDays =  ((_networkHashRate / _myHashRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                coinStats.luckHours = ((_networkHashRate / _myHashRate * _blocktime) / (60 * 60)).toFixed(3);
                coinStats.minerCount = Object.keys(coinStats.miners).length;

                coinStats.workerCount = Object.keys(coinStats.workers).length;
                portalStats.global.workers += coinStats.workerCount;

                // Algorithm-Specific Statistics
                var algo = coinStats.algorithm;
                if (!portalStats.algos.hasOwnProperty(algo)) {
                    portalStats.algos[algo] = {
                        workers: 0,
                        hashrate: 0,
                        hashrateString: null
                    };
                }
                portalStats.algos[algo].hashrate += coinStats.hashrate;
                portalStats.algos[algo].workers += Object.keys(coinStats.workers).length;

                for (var worker in coinStats.currentRoundShares) {
                    var miner = worker.split(".")[0];
                    if (miner in coinStats.miners) {
                        coinStats.miners[miner].currRoundShares += parseFloat(coinStats.currentRoundShares[worker]);
                    }
                    if (worker in coinStats.workers) {
                        coinStats.workers[worker].currRoundShares += parseFloat(coinStats.currentRoundShares[worker]);
                    }
                    _shareTotal += parseFloat(coinStats.currentRoundShares[worker]);
                }

                for (var worker in coinStats.currentRoundTimes) {
                    var time = parseFloat(coinStats.currentRoundTimes[worker]);
                    if (_maxTimeShare < time) { _maxTimeShare = time; }
                    var miner = worker.split(".")[0];
                    if (miner in coinStats.miners && coinStats.miners[miner].currRoundTime < time) {
                        coinStats.miners[miner].currRoundTime = time;
                    }
                }

                coinStats.shareCount = _shareTotal;
                coinStats.maxRoundTime = _maxTimeShare;
                coinStats.maxRoundTimeString = readableSeconds(_maxTimeShare);

                for (var worker in coinStats.workers) {
                    var _workerRate = shareMultiplier * coinStats.workers[worker].shares / portalConfig.website.stats.hashrateWindow;
                    var _wHashRate = (_workerRate / 1000000) * 2;
                    coinStats.workers[worker].luckDays = ((_networkHashRate / _wHashRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                    coinStats.workers[worker].luckHours = ((_networkHashRate / _wHashRate * _blocktime) / (60 * 60)).toFixed(3);
                    coinStats.workers[worker].hashrate = _workerRate;
                    coinStats.workers[worker].hashrateString = _this.getReadableHashRateString(_workerRate);
                    var miner = worker.split('.')[0];
                    if (miner in coinStats.miners) {
                        coinStats.workers[worker].currRoundTime = coinStats.miners[miner].currRoundTime;
                    }
                }

                for (var miner in coinStats.miners) {
                    var _workerRate = shareMultiplier * coinStats.miners[miner].shares / portalConfig.website.stats.hashrateWindow;
                    var _wHashRate = (_workerRate / 1000000) * 2;
                    coinStats.miners[miner].luckDays = ((_networkHashRate / _wHashRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                    coinStats.miners[miner].luckHours = ((_networkHashRate / _wHashRate * _blocktime) / (60 * 60)).toFixed(3);
                    coinStats.miners[miner].hashrate = _workerRate;
                    coinStats.miners[miner].hashrateString = _this.getReadableHashRateString(_workerRate);
                }

                // Sort Workers by Name
                coinStats.workers = sortWorkersByName(coinStats.workers);

                // Clean Up Information
                delete coinStats.hashrates;
                delete coinStats.shares;
            });

            // Clean Up Information
            Object.keys(portalStats.algos).forEach(function(algo) {
                var algoStats = portalStats.algos[algo];
                algoStats.hashrateString = _this.getReadableHashRateString(algoStats.hashrate);
            });

            // Save only Historical Data
            var saveStats = JSON.parse(JSON.stringify(portalStats));
            Object.keys(saveStats.pools).forEach(function(pool){
                delete saveStats.pools[pool].pending;
                delete saveStats.pools[pool].confirmed;
                delete saveStats.pools[pool].currentRoundShares;
                delete saveStats.pools[pool].currentRoundTimes;
                delete saveStats.pools[pool].payments;
                delete saveStats.pools[pool].miners;
            });

            _this.stats = portalStats;
            _this.statsString = JSON.stringify(saveStats);
            _this.statHistory.push(saveStats);
            addStatPoolHistory(portalStats);

            // Remove Data Stored Past Retention Time
            var retentionTime = (((Date.now() / 1000) - portalConfig.stats.historicalRetention) | 0);
            for (var i = 0; i < _this.statHistory.length; i++) {
                if (retentionTime < _this.statHistory[i].time) {
                    if (i > 0) {
                        _this.statHistory = _this.statHistory.slice(i);
                        _this.statPoolHistory = _this.statPoolHistory.slice(i);
                    }
                    break;
                }
            }

            // Append to Stat History
            redisStats.multi([
                ['zadd', 'statHistory', statGatherTime, _this.statsString],
                ['zremrangebyscore', 'statHistory', '-inf', '(' + retentionTime]
            ]).exec(function(err, replies) {
                if (err)
                    logger.error(logSystem, 'Historics', 'Error adding stats to historics ' + JSON.stringify(err));
            });
            callback();
        });
    };
};

// Export Pool Stats
module.exports = PoolStats;
