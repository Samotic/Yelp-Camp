maptilersdk.config.apiKey = maptilerApiKey;

const map = new maptilersdk.Map({
    container: 'cluster-map',
    style: maptilersdk.MapStyle.BRIGHT,
    center: [-103.59179687498357, 40.66995747013945],
    zoom: 3
});

map.on('load', function () {
    map.addSource('campgrounds', {
        type: 'geojson',
        data: campgrounds,
        cluster: true,
        clusterMaxZoom: 14, // Max zoom to cluster points on
        clusterRadius: 50 // Radius of each cluster when clustering points (defaults to 50)
    });

    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'campgrounds',
        filter: ['has', 'point_count'],
        paint: {
            // Use step expressions (https://docs.maptiler.com/gl-style-specification/expressions/#step)
            // with three steps to implement three types of circles:
            'circle-color': [
                'step',
                ['get', 'point_count'],
                '#00BCD4',
                10,
                '#2196F3',
                30,
                '#3F51B5'
            ],
            'circle-radius': [
                'step',
                ['get', 'point_count'],
                15,
                10,
                20,
                30,
                25
            ]
        }
    });

    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'campgrounds',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12
        }
    });

    map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'campgrounds',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': '#11b4da',
            'circle-radius': 4,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
        }
    });

    // inspect a cluster on click
    map.on('click', 'clusters', async (e) => {
        const features = map.queryRenderedFeatures(e.point, {
            layers: ['clusters']
        });
        const clusterId = features[0].properties.cluster_id;
        const zoom = await map.getSource('campgrounds').getClusterExpansionZoom(clusterId);
        map.easeTo({
            center: features[0].geometry.coordinates,
            zoom
        });
    });

    // When a click event occurs on a feature in
    // the unclustered-point layer, open a popup at
    // the location of the feature, with
    // description HTML from its properties.
    map.on('click', 'unclustered-point', function (e) {
        const { popUpMarkup } = e.features[0].properties;
        const origin = e.features[0].geometry.coordinates;
        const coordinates = origin.slice();

        // Ensure that if the map is zoomed out such that
        // multiple copies of the feature are visible, the
        // popup appears over the copy being pointed to.
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        const popup = new maptilersdk.Popup({ maxWidth: '300px', className: 'camp-popup' })
            .setLngLat(coordinates)
            .setHTML(popUpContent(popUpMarkup, seismicLoading()))
            .addTo(map);

        // The popup opens straight away and fills in its seismic line when USGS
        // answers, so the click never waits on the network. If the lookup fails
        // the line degrades to a muted note instead of breaking the popup.
        // `origin` is the unwrapped coordinate — the copy-shifted one above
        // would send a longitude outside [-180, 180] to USGS.
        fetchSeismicHistory(origin)
            .then(history => {
                if (popup.isOpen()) popup.setHTML(popUpContent(popUpMarkup, seismicResult(history)));
            })
            .catch(() => {
                if (popup.isOpen()) popup.setHTML(popUpContent(popUpMarkup, seismicUnavailable()));
            });
    });

    map.on('mouseenter', 'clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters', () => {
        map.getCanvas().style.cursor = '';
    });
});


/* ---------------------------------------------------------------------------
   Seismic history
   ---------------------------------------------------------------------------
   Answers "has the ground here ever shaken?" for one campground by asking the
   USGS FDSN event service for quakes recorded inside a radius around its
   coordinates. Public, keyless and CORS-enabled, so it runs straight from the
   browser with no route or schema changes.

   Two small requests rather than one big one: `count` returns an exact total as
   a few bytes, and `query` capped at a single magnitude-ordered result returns
   the strongest event. Downloading every quake would mean megabytes in places
   like California.
--------------------------------------------------------------------------- */

const QUAKE_RADIUS_KM = 100;   // roughly "close enough to have been felt here"
const QUAKE_MIN_MAG = 2.5;     // below this is instrument-only, nobody notices
const QUAKE_SINCE = '1900-01-01';
const USGS_ENDPOINT = 'https://earthquake.usgs.gov/fdsnws/event/1';

// Campgrounds don't move, so an answer is good for the life of the page.
const seismicCache = new Map();

const usgsUrl = (method, [longitude, latitude], extra = {}) => {
    const params = new URLSearchParams({
        format: 'geojson',
        latitude,
        longitude,
        maxradiuskm: QUAKE_RADIUS_KM,
        minmagnitude: QUAKE_MIN_MAG,
        starttime: QUAKE_SINCE,
        ...extra
    });
    return `${USGS_ENDPOINT}/${method}?${params}`;
};

const fetchSeismicHistory = (coordinates) => {
    const key = coordinates.slice(0, 2).map(n => n.toFixed(4)).join(',');
    if (!seismicCache.has(key)) {
        const lookup = (async () => {
            const [countRes, strongestRes] = await Promise.all([
                fetch(usgsUrl('count', coordinates)),
                fetch(usgsUrl('query', coordinates, { orderby: 'magnitude', limit: 1 }))
            ]);
            if (!countRes.ok || !strongestRes.ok) throw new Error('USGS lookup failed');
            const { count } = await countRes.json();
            const { features } = await strongestRes.json();
            return { count, strongest: features.length ? features[0].properties : null };
        })();
        // Don't cache a failure, or one dropped connection poisons that
        // campground for the rest of the session.
        lookup.catch(() => seismicCache.delete(key));
        seismicCache.set(key, lookup);
    }
    return seismicCache.get(key);
};

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]
));

// USGS magnitudes are open-ended; these bands mirror how the scale is usually
// described in plain language (light / moderate / strong / severe).
const magnitudeTier = (mag) => {
    if (mag >= 6.5) return 'severe';
    if (mag >= 5) return 'strong';
    if (mag >= 4) return 'moderate';
    return 'light';
};

const popUpContent = (campgroundMarkup, seismicBlock) => `
    <div class="camp-popup__body">${campgroundMarkup}</div>
    <div class="camp-popup__seismic">
        <div class="camp-popup__seismic-label">Seismic history</div>
        ${seismicBlock}
    </div>`;

const seismicLoading = () => `
    <div class="seismic__state">
        <span class="seismic__pulse"></span>Checking USGS records…
    </div>`;

const seismicUnavailable = () => `
    <div class="seismic__state">Seismic history unavailable</div>`;

const seismicResult = ({ count, strongest }) => {
    if (!count || !strongest) {
        return `<div class="seismic__state">No recorded quakes within ${QUAKE_RADIUS_KM} km</div>`;
    }

    const mag = Number(strongest.mag);
    const year = new Date(strongest.time).getUTCFullYear();
    const quakes = `${count.toLocaleString()} ${count === 1 ? 'quake' : 'quakes'}`;

    return `
        <div class="seismic__result">
            <span class="seismic__badge seismic__badge--${magnitudeTier(mag)}">M${mag.toFixed(1)}</span>
            <div class="seismic__detail">
                <span class="seismic__count">${quakes} within ${QUAKE_RADIUS_KM} km</span>
                <span class="seismic__meta" title="${escapeHtml(strongest.place ?? '')}">
                    Strongest ${year} · ${escapeHtml(strongest.place ?? 'location unknown')}
                </span>
            </div>
        </div>`;
}; 