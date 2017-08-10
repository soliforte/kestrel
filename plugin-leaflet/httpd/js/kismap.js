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
