/*
 *
 * PoolServer (Updated)
 *
 */

// Import Network Modules
var express = require('express');
var compress = require('compression');
var bodyParser = require('body-parser');

// Import Pool Functionality
var PoolAPI = require('./api.js');

// Pool Server Main Function
var PoolServer = function (logger) {

    // Load Useful Data from Process
    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    // Establish Server Variables
    var portalApi = new PoolAPI(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;
    var logSystem = 'Server';

    // Establish Global Statistics
    portalStats.getGlobalStats(function() {
        return;
    });

    // Build Main Server
    var app = express();
    app.use(bodyParser.json());
    app.use(compress());
    app.get('/api/:method', function(req, res, next) {
        portalApi.handleApiRequest(req, res, next);
    });
    app.use(function(err, req, res, next) {
        console.error(err.stack);
        res.send(500, 'Something broke!');
    });

    try {
        // Main Server is Running
        app.listen(portalConfig.server.port, portalConfig.server.host, function () {
            logger.debug(logSystem, 'Server', 'Website started on ' +
            portalConfig.server.host + ':' + portalConfig.server.port);
        });
    }
    catch(e) {
        // Error Starting Main Server
        logger.error(logSystem, 'Server', 'Could not start website on ' +
        portalConfig.server.host + ':' + portalConfig.server.port +
        ' - its either in use or you do not have permission');
    }
}

// Export Pool Server
module.exports = PoolServer;