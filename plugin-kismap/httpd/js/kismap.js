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

      $(div).append('<head>');
      $(div).append('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      $(div).append('<link rel="shortcut icon" type="image/x-icon" href="docs/images/favicon.ico" />');
      $(div).append('<link rel="stylesheet" href="/plugin/kismap/leaflet.css">');
      $(div).append('<script src="/plugin/kismap/js/leaflet.js"></script>');
      $(div).append('<link rel="stylesheet" href="/plugin/kismap/LeafletStyleSheet.css">')
      $(div).append('<script src="/plugin/kismap/js/PruneCluster.js"></script>');
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

      new L.Control.Zoom({
        position: 'topright'
      }).addTo(mymap);

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

    var opMarker = new L.marker([0,0]);

    //$(window).ready( function() {
    //  $.getJSON("/devices/last-time/-5/devices.json").done(function(devs) {
    //    var lat = devs[0]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lat'];
    //    var lon = devs[0]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lon'];
    //    var opMarker = L.marker([lat, lon]).addTo(mymap);
    //  })
    //});

    //function plotOp() {
    //  $.getJSON("/devices/last-time/-5/devices.json").done(function(devs) {
    //    var lat = devs[0]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lat'];
    //    var lon = devs[0]['kismet.device.base.signal']['kismet.common.signal.peak_loc']['kismet.common.location.lon'];
    //    opMarker.setLatLng(lat,lon).update(mymap);
    //    //opMarker.setView(); // Not tested yet, but should center map on current location
    //    console.log('New: ' + lat, lon)
    //  })
    //};

    //$(window).ready( function(){
    //  setInterval(plotOp, 900);
    //})
    //mymap.on('click', plotOp);

      $(window).ready( function() {
       setInterval(getDevs, 20000);
      });
      //Main routine, this gets devices and plots them
      function getDevs() {
        //Get devices within the last n seconds. Make this throttle-able with a form??
        var markers =[];
        $.getJSON("/devices/last-time/-20/devices.json").done(function(devs) {
            for (var x = 0; x < devs.length; x++) {
              var ssid = devs[x]['kismet.device.base.name'];
              var type = devs[x]['kismet.device.base.type'];
              var mac = devs[x]['kismet.device.base.macaddr'];
              var rssi = devs[x]['kismet.device.base.signal']['kismet.common.signal.max_signal_dbm']; //Last signal dBm
              var lat = devs[x]['kismet.device.base.location']['kismet.common.location.avg_loc']['kismet.common.location.lat'];
              var lon = devs[x]['kismet.device.base.location']['kismet.common.location.avg_loc']['kismet.common.location.lon'];
              if (type == 'Wi-Fi AP'){
                //console.log(ssid, type, mac, lat, lon);
                var popup = "<b>" + ssid + "</b><br>" + mac + "<br>" + rssi;
                var netmark = new PruneCluster.Marker(lat, lon);
                netmark.category = 1;
                netmark.weight = 1;
                netmark.data.id = mac;
                netmark.data.popup = popup;
                netmark.filtered = false;
                markers.push(netmark);
                dataCluster.RegisterMarker(netmark);
              } else if (type == 'Wi-Fi Bridged Device') {
                //console.log(ssid, type, mac, lat, lon);
                var popup = "<b>" + ssid + "</b><br>" + mac + "<br>" + rssi;
                var bridgemark = new PruneCluster.Marker(lat, lon);
                bridgemark.category = 2;
                bridgemark.weight = 2;
                bridgemark.data.id = mac;
                bridgemark.data.popup = popup;
                bridgemark.filtered = false;
                markers.push(bridgemark);
                dataCluster.RegisterMarker(bridgemark);
              } else if (type == 'Wi-Fi Client'){
                //console.log(ssid, type, mac, lat, lon);
                var popup = "<b>Client: </b>" + mac + "<br>" + rssi;
                var climarker = new PruneCluster.Marker(lat, lon);
                climarker.category = 3;
                climarker.weight = 3;
                climarker.data.id = mac;
                climarker.data.popup = popup;
                climarker.filtered = false;
                markers.push(climarker);
                dataCluster.RegisterMarker(climarker);
              }
              dataCluster.ProcessView();
            }// end of for
            mymap.addLayer( dataCluster ).setView([lat,lon], 18);
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
