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
	createCallback: function(div) {
    $(document).ready( function() {

      $(div).append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      $(div).append('<link rel="shortcut icon" type="image/x-icon" href="docs/images/favicon.ico" />');
      $(div).append('<link rel="stylesheet" href="/plugin/kismap/leaflet.css">');
      $(div).append('<script src="/plugin/kismap/js/leaflet.js"></script>');
      $(div).append('<link rel="stylesheet" href="/plugin/kismap/MarkerCluster.css">')
      $(div).append('<script src="/plugin/kismap/js/leaflet.markercluster.js">')
      //Instantiate cluster for le clustering of devices
      var dataCluster = new L.MarkerClusterGroup();
      //Instantiate le map
      var mymap = L.map('mapid').setView([40.775,-73.972], 15);
            L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw', {
                    maxZoom: 18,
                    attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ' +
                            '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                            'Imagery © <a href="http://mapbox.com">Mapbox</a>',
                    id: 'mapbox.streets'
            }).addTo(mymap);
      //Probably removing this. Gets current location via browser API
      $( window ).ready( function(){
          mymap.locate({setView: true, maxZoom: 15, watch: true});
      });

      //Once location is found, drop a marker on that location
      mymap.on('locationfound', onLocationFound);
        function onLocationFound(e) {
            console.log(e);
        // e.heading will contain the user's heading (in degrees) if it's available, and if not it will be NaN. This would allow you to point a marker in the same direction the user is pointed.
            var marker = L.marker(e.latlng).addTo(mymap);
            marker.bindPopup("Operator").openPopup();
      }

      //Main routine, this gets devices and plots them
      $(mymap).ready(function() {
        //Get devices within the last n seconds. Make this throttle-able with a form??
        $.getJSON("/devices/last-time/-60/devices.json").done(function(data) {
            console.log(mac, lat, lon);
            for (var x = 0; x < data.length; x++) {
              var ssid = data[x]['kismet.device.base.name'];
              var type = data[x]['kismet.device.base.type'];
              var mac = data[x]['kismet.device.base.macaddr'];
              var lat = data[x]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lat'];
              var lon = data[x]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lon'];
              if (type = 'Wi-Fi AP'){
                console.log(ssid, type, mac, lat, lon);
                var popup = "<b>" + ssid + "</b><br>" + mac;
                var marker = new L.marker([lat, lon]).addTo(mymap).bindPopup( popup );
                dataCluster.addLayer( marker );
              }
            }
            mymap.addLayer( dataCluster );
          }); //end of getJSON
        }); //end of mymap.ready
      }); //end of document.ready
    }, //end of function(div)
	   priority:    -999,
   }); //End of createCallback
// We're done loading
exports.load_complete = 1;
return exports;
});
