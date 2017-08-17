(
  typeof define === "function" ? function (m) { define("plugin-kismap-js", m); } :
  typeof exports === "object" ? function (m) { module.exports = m(); } :
  function(m){ this.kismap = m(); }
)(function () {

  "use strict";

  var exports = {};

  // Flag we're still loading
  exports.load_complete = 0;

kismet_ui_tabpane.AddTab({
	id:    'mapid',
	tabTitle:    'Maps',
	expandable: true,
	createCallback: function(div) {
    $(document).ready( function() {
      $.getScript('/plugin/kismap/js/leaflet.js')
      $(div).append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      $(div).append('<link rel="shortcut icon" type="image/x-icon" href="docs/images/favicon.ico" />');
      $(div).append('<link rel="stylesheet" href="/plugin/kismap/leaflet.css">');
      $(div).append('<script src="/plugin/kismap/js/leaflet.js"></script>');
      var mymap = L.map('mapid').setView([40.775,-73.972], 15);
            L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw', {
                    maxZoom: 18,
                    attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ' +
                            '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                            'Imagery © <a href="http://mapbox.com">Mapbox</a>',
                    id: 'mapbox.streets'
            }).addTo(mymap);

      $( window ).ready( function(){
          mymap.locate({setView: true, maxZoom: 15});
      });

      mymap.on('locationfound', onLocationFound);
        function onLocationFound(e) {
            console.log(e);
        // e.heading will contain the user's heading (in degrees) if it's available, and if not it will be NaN. This would allow you to point a marker in the same direction the user is pointed.
            L.marker(e.latlng).addTo(mymap);
            L.popup().setLatLng(e.latlng).setContent("Operator").openOn(mymap);
      }

      $( window ).ready( function() {
        $.getJSON("localhost:2501/devices/by-ts/-60/devices.json").done(function(data) {
        var mac = data['kismet.device.base.macaddr'];
        var lat = data['kismet.common.signal.peak_loc']['kismet.common.location.lat'];
        var lon = data['kismet.common.signal.peak_loc']['kismet.common.location.lon'];
        var coordinates = lat + lon;
        for (var x = 0; x < data.length; x++) {
           var marker = L.marker([lat, lon]).addTo(mymap);
           var popop = L.popup()
              .setLatLng([lat, lon])
              .setContent(mac)
              .openOn(mymap);
         }
      })
    })
    })
	},
	priority:    -999,
});
// We're done loading
exports.load_complete = 1;
return exports;
});
