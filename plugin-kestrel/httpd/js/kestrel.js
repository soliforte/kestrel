// Author: soliforte
// Email: soliforte@protonmail.com
// Git: github.com/soliforte
// Freeware, enjoy. If you do something really cool with it, let me know. Pull requests encouraged

(
  typeof define === "function" ? function (m) { define("plugin-kestrel-js", m); } :
  typeof exports === "object" ? function (m) { module.exports = m(); } :
  function(m){ this.kestrel = m(); }
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

      $(div).append('<head>');
      $(div).append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      $(div).append('<link rel="shortcut icon" type="image/x-icon" href="docs/images/favicon.ico" />');
      $(div).append('<script src="/plugin/kestrel/js/underscore-min.js"></script>');
      $(div).append('<link rel="stylesheet" href="/plugin/kestrel/leaflet.css">');
      $(div).append('<script src="/plugin/kestrel/js/leaflet.js"></script>');
      $(div).append('<link rel="stylesheet" href="/plugin/kestrel/LeafletStyleSheet.css">');
      $(div).append('<script src="/plugin/kestrel/js/PruneCluster.js"></script>');
      $(div).append('<script src="/plugin/kestrel/js/leaflet.mouseCoordinate.js">');
      $(div).append('<link rel="stylesheet" href="/plugin/kestrel/leaflet.mouseCoordinate.css">')
      $(div).append('</head>');
      $(div).append('<ul class="side-menu">');

      //Instantiate cluster for le clustering of devices
      var dataCluster = new PruneClusterForLeaflet();
      //Build custom ClusterIcon
      dataCluster.BuildLeafletClusterIcon = function(cluster) {
        var e = new L.Icon.MarkerCluster();
        e.stats = cluster.stats;
        e.population = cluster.population;
        return e;
      };

      //Instantiate map
      var mymap = L.map('mapid').setView([40.775,-73.972], 15);
            L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(mymap);
      //Probably removing this. Gets current location via browser API
      $( window ).ready( function(){
          mymap.locate({setView: true, maxZoom: 15});
      });
      //Once location is found, drop a marker on that location
	L.control.mouseCoordinate({gps:true,position:'bottomright'}).addTo(mymap);

      var colors = ['#ff4b00', '#bac900', '#EC1813', '#55BCBE', '#D2204C', '#FF0000', '#ada59a', '#3e647e'],
        pi2 = Math.PI * 2;

      L.Icon.MarkerCluster = L.Icon.extend({
        options: {
            iconSize: new L.Point(44, 44),
            className: 'prunecluster leaflet-markercluster-icon'
        },
          createIcon: function () {
              // based on L.Icon.Canvas from shramov/leaflet-plugins (BSD licence)
              var e = document.createElement('canvas');
              this._setIconStyles(e, 'icon');
              var s = this.options.iconSize;
              e.width = s.x;
              e.height = s.y;
              this.draw(e.getContext('2d'), s.x, s.y);
              return e;
            },
            createShadow: function () {
              return null;
            },
            draw: function(canvas, width, height) {
              var lol = 0;
              var start = 0;
              for (var i = 0, l = colors.length; i < l; ++i) {
                  var size = this.stats[i] / this.population;
                  if (size > 0) {
                      canvas.beginPath();
                      canvas.moveTo(22, 22);
                      canvas.fillStyle = colors[i];
                      var from = start + 0.14,
                          to = start + size * pi2;
                      if (to < from) {
                          from = start;
                      }
                      canvas.arc(22,22,22, from, to);
                      start = start + size*pi2;
                      canvas.lineTo(22,22);
                      canvas.fill();
                      canvas.closePath();
                  }
              }
            canvas.beginPath();
            canvas.fillStyle = 'white';
            canvas.arc(22, 22, 18, 0, Math.PI*2);
            canvas.fill();
            canvas.closePath();
            canvas.fillStyle = '#555';
            canvas.textAlign = 'center';
            canvas.textBaseline = 'middle';
            canvas.font = 'bold 12px sans-serif';
            canvas.fillText(this.population, 22, 22, 40);
        }
    });
    var markers = [];
    var macs = [];

    $(window).ready( function() {
     setInterval(addDevs, 5000);
    });

    function addDevs() {
      getDevs();
      var uniqmacs = _.uniq(macs, 'MAC');
      dataCluster.RemoveMarkers();
      var search = document.getElementsByTagName("input")[0].value;
      console.log(search);
      for ( var i in uniqmacs){
        var marker = new PruneCluster.Marker(uniqmacs[i]['LAT'], uniqmacs[i]['LON']);
        marker.data.id = uniqmacs[i]['MAC'];
        marker.filtered = false;
        if (uniqmacs[i]['TYPE'] == "Wi-Fi AP"){
          marker.category = 1;
          marker.weight = 1;
        } else if (uniqmacs[i]['TYPE'] == "Wi-Fi Client") {
          marker.category = 2;
          marker.weight = 1;
        } else if (uniqmacs[i]['TYPE'] == "Wi-Fi Bridged Device"){
          marker.category = 3;
          marker.weight = 1;
        } else {
          marker.category = 5;
          marker.weight = 1;
        };
        marker.data.popup = uniqmacs[i]['SSID']+'<br>'+uniqmacs[i]['MAC']+'<br>'+uniqmacs[i]['TYPE'];
        if ( uniqmacs[i]['SSID'].includes(search)){
          dataCluster.RegisterMarker(marker);
        } else if ( uniqmacs[i]['MAC'].includes(search)){
          dataCluster.RegisterMarker(marker);
        } else if ( uniqmacs[i]['TYPE'].includes(search)){
          dataCluster.RegisterMarker(marker);
        };
      };
      dataCluster.ProcessView();
      var latlon = _.last(uniqmacs);

      mymap.addLayer( dataCluster ); // Temporarily disabled locking-to-location until I figure a way to make it toggle-able. you can re-enable by adding .setView([latlon['LAT'],latlon['LON']], 16) to the end of this line
      macs = uniqmacs;
    }

      //Main routine, this gets devices and plots them
    function getDevs() {
      //Get devices within the last n seconds. Make this throttle-able with a form??
      var newmarkers =[];
      //var newmacs = [];
      $.getJSON("/devices/last-time/-20/devices.json").done(function(devs) {
          for (var x = 0; x < devs.length; x++) {
            var ssid = devs[x]['kismet.device.base.name'];
            var type = devs[x]['kismet.device.base.type'];
            var mac = devs[x]['kismet.device.base.macaddr'];
            var rssi = devs[x]['kismet.device.base.signal']['kismet.common.signal.max_signal_dbm']; //Last signal dBm
            var lat = devs[x]['kismet.device.base.location']['kismet.common.location.avg_loc']['kismet.common.location.lat'];
            var lon = devs[x]['kismet.device.base.location']['kismet.common.location.avg_loc']['kismet.common.location.lon'];
            var device = {SSID: ssid, TYPE: type, MAC: mac, RSSI: rssi, LAT: lat, LON: lon};
            macs.push(device);
          }// end of for
        }); //end of getJSON
      }; //end of getdevs
    }); //end of document.ready
  }, //end of function(div)
   priority:    -999,
 }); //End of createCallback
// We're done loading
exports.load_complete = 1;
return exports;
});
