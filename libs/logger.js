/* PoolLogger (Updated) */

// Import Required Modules
var dateFormat = require("dateformat");
var colors = require("colors");

// Establish Severity Values
var severityValues = {
	debug: 1,
	warning: 2,
	error: 3,
	special: 4
};

// Indicate Severity By Colors
var severityColors = function (severity, text) {
	switch (severity) {
		case "special":
			return text.green.underline;
		case "debug":
			return text.cyan;
		case "warning":
			return text.bgYellow.grey.bold;
		case "error":
			return text.bgRed.white.bold;
		default:
			console.log(`Unknown severity ${severity}`);
			return text.magenta;
	}
};

// Pool Logger Main Function
var PoolLogger = function (portalConfig) {
	// Establish Initial Severity
	var logLevelInt = severityValues[portalConfig.logLevel];
	var logColors = portalConfig.logColors;

	// Establish Log Main Functon
	var log = function (severity, system, component, text, subcat) {
		// Check Regarding Current Severity Valued
		if (severityValues[severity] < logLevelInt) return;

		// Check if SubCategory
		if (subcat) {
			var realText = subcat;
			var realSubCat = text;
			text = realText;
			subcat = realSubCat;
		}

		// Manage Logger Message
		var entryDesc = `${dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss")} [${system}]\t`;

		if (logColors) {
			entryDesc = severityColors(severity, entryDesc);
			// Format Logger Message
			var logString = entryDesc + `[${component}] `;
			if (subcat) {
				logString += `(${subcat}) `.white.bold;
			}
			logString += text.white;
		} else {
			// Format Logger Message
			var logString = `${entryDesc}[${component}] `;
			if (subcat) {
				logString += `(${subcat}) `;
			}
			logString += text;
		}
		// Print Formatted Logger Message
		console.log(logString);
	};

	// Manage Logger Messages
	var _this = this;
	Object.keys(severityValues).forEach(function (logType) {
		_this[logType] = function () {
			var args = Array.prototype.slice.call(arguments, 0);
			args.unshift(logType);
			log.apply(this, args);
		};
	});
};

// Export Pool Logger
module.exports = PoolLogger;
