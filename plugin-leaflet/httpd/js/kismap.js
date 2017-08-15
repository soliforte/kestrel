(
  typeof define === "function" ? function (m) { define("plugin-kismap-js", m); } :
  typeof exports === "object" ? function (m) { module.exports = m(); } :
  function(m){ this.kismap = m(); }
)(function () {

"use strict";

var exports = {};

// Flag we're still loading
exports.load_complete = 0;


alert("Maps has loaded!")
kismet_ui_tabpane.AddTab({
	id:    'leaflet',
	tabTitle:    'Maps',
	expandable: true,
	createCallback: function(div) {
	var loadcontent = $('<div>');
    	loadcontent.load('/plugin/leaflet/leaflet.html', function() {
        		div.append(loadcontent);
   		});
	},
	priority:    -999,
});


// We're done loading
exports.load_complete = 1;

return exports;

});

