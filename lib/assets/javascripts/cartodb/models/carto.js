

carto_quotables = [
  'text-face-name'
];

carto_variables = [
  'text-name'
];

var carto_functionMap= {
  'Equal Interval': 'quartiles',
  'Jenks': 'jenkBins',
  'Heads/Tails': 'headTails',
  'Quantile': 'quantileBins'
};

DEFAULT_QFUNCTION = 'Quantile';

/**
 *  Manage some carto properties depending on
 *  type (line, polygon or point), for choropleth.
 */
function manage_choropleth_props(type, props) {
  var carto_props = {
    'marker-width': props['marker-width'],
    'marker-opacity': props['marker-opacity'],
    'marker-line-width': props['marker-line-width'],
    'marker-line-color': props['marker-line-color'],
    'marker-line-opacity': props['marker-line-opacity'],
    'marker-allow-overlap': props['marker-allow-overlap'],
    'line-color': props['line-color'],
    'line-opacity': props['line-opacity'],
    'line-width': props['line-width'],
    'polygon-opacity': type == "line" ? 0 : props['polygon-opacity'],
    'text-name': props['text-name'],
    'text-halo-fill': props['text-halo-fill'],
    'text-halo-radius': props['text-halo-radius'],
    'text-face-name': props['text-face-name'],
    'text-size': props['text-size'],
    'text-dy': props['text-dy'],
    'text-allow-overlap': props['text-allow-overlap'],
    'text-placement': props['text-placement'],
    'text-placement-type': props['text-placement-type'],
    'text-label-position-tolerance': props['text-label-position-tolerance'],
    'text-fill': props['text-fill']
  }

  // Remove all undefined properties
  _.each(carto_props, function(v, k){
    if(v === undefined) delete carto_props[k];
  });

  return carto_props;
}

function getProp(obj, prop) {
  var p = [];
  for(var k in obj) {
    var v = obj[k];
    if (k === prop) {
      p.push(v);
    } else if (typeof(v) === 'object') {
      p = p.concat(getProp(v, prop));
    }
  }
  return p;
}

var _cartocss_spec_props = getProp(_mapnik_reference_latest, 'css');

/**
 * some carto properties depends on others, this function
 * remove or add properties needed to carto works
 */
function manage_carto_properies(props) {

  if(/none/i.test(props['text-name']) || !props['text-name']) {
    // remove all text-* properties
    for(var p in props) {
      if(isTextProperty(p)) {
        delete props[p];
      }
    }
  }

  if(/none/i.test(props['polygon-comp-op'])) {
    delete props['polygon-comp-op'];
  }
  if(/none/i.test(props['line-comp-op'])) {
    delete props['line-comp-op'];
  }
  if(/none/i.test(props['marker-comp-op'])) {
    delete props['marker-comp-op'];
  }

  // if polygon-pattern-file is present polygon-fill should be removed
  if('polygon-pattern-file' in props) {
    delete props['polygon-fill'];
  }

  delete props.zoom;

  return _.pick(props, _cartocss_spec_props)

}

function isTextProperty(p) {
  return /^text-/.test(p);
}

function generate_carto_properties(props) {
  return _(props).map(function(v, k) {
    if(_.include(carto_quotables, k)) {
      v = "'" + v + "'";
    }
    if(_.include(carto_variables, k)) {
      v = "[" + v + "]";
    }
    return "  " + k + ": " + v + ";";
  });
}

function filter_props(props, fn) {
  var p = {};
  for(var k in props) {
    var v = props[k];
    if(fn(k, v)) {
      p[k] = v;
    }
  }
  return p;
}

function simple_polygon_generator(table, props, changed, callback) {

  // remove unnecesary properties, for example
  // if the text-name is not present remove all the
  // properties related to text
  props = manage_carto_properies(props);

  var text_properties = filter_props(props, function(k, v) { return isTextProperty(k); });
  var general_properties = filter_props(props, function(k, v) { return !isTextProperty(k); });

  generalLayerProps = generate_carto_properties(general_properties);
  textLayerProps = generate_carto_properties(text_properties);

  // layer with non-text properties
  var generalLayer = "#" + table.get('name') + "{\n" + generalLayerProps.join('\n') + "\n}";
  var textLayer = '';
  if(_.size(textLayerProps)) {
    textLayer = "\n\n#" + table.get('name') + "::labels {\n" + textLayerProps.join('\n') + "\n}\n";
  }

  // text properties layer
  callback(generalLayer + textLayer);
}

function intensity_generator(table, props, changed, callback) {
  var table_name = table.get('name');

  // remove unnecesary properties, for example
  // if the text-name is not present remove all the
  // properties related to text
  props = manage_carto_properies(props);

  var carto_props = {
    'marker-fill': props['marker-fill'],
    'marker-width': props['marker-width'],
    'marker-line-color': props['marker-line-color'],
    'marker-line-width': props['marker-line-width'],
    'marker-line-opacity': props['marker-line-opacity'],
    'marker-opacity': props['marker-opacity'],
    'marker-comp-op': 'multiply',
    'marker-type': 'ellipse',
    'marker-placement': 'point',
    'marker-allow-overlap': true,
    'marker-clip': false,
    'marker-multi-policy': 'largest'
  };

  var css = "\n#" + table_name +"{\n";

  _(carto_props).each(function(prop, name) {
    css += "  " + name + ": " + prop + "; \n";
  });

  css += "}";
  callback(css);

}

function cluster_sql(table, zoom, props, nquartiles) {

  var grids = ["A", "B", "C", "D", "E"];
  var bucket = "bucket" + grids[0];
  var mainBucket = bucket;

  var sizes = [];
  var step = 1 / (nquartiles + 1);

  for (var i = 0; i < nquartiles; i++) {
    sizes.push( 1 - step * i)
  }

  var sql = "WITH meta AS ( " +
    "   SELECT greatest(!pixel_width!,!pixel_height!) as psz, ext, ST_XMin(ext) xmin, ST_YMin(ext) ymin FROM (SELECT !bbox! as ext) a " +
    " ), " +
    " filtered_table AS ( " +
    "   SELECT t.* FROM <%= table %> t, meta m WHERE t.the_geom_webmercator && m.ext " +
    " ), ";

  for (var i = 0; i<nquartiles; i++) {
    bucket = "bucket" + grids[i];

    if (i == 0){
      sql += mainBucket + "_snap AS (SELECT ST_SnapToGrid(f.the_geom_webmercator, 0, 0, m.psz * <%= size %>, m.psz * <%= size %>) the_geom_webmercator, count(*) as points_count, 1 as cartodb_id, array_agg(f.cartodb_id) AS id_list "
    }
    if (i > 0){
      sql += "\n" + bucket + "_snap AS (SELECT ST_SnapToGrid(f.the_geom_webmercator, 0, 0, m.psz * " + sizes[i] + " * <%= size %>, m.psz * " + sizes[i] + " * <%= size %>) the_geom_webmercator, count(*) as points_count, 1 as cartodb_id, array_agg(f.cartodb_id) AS id_list "
    }

    sql += " FROM filtered_table f, meta m "

    if (i == 0){
      sql += " GROUP BY ST_SnapToGrid(f.the_geom_webmercator, 0, 0, m.psz * <%= size %>, m.psz * <%= size %>), m.xmin, m.ymin), ";
    }

    if (i > 0){
      sql += " WHERE cartodb_id NOT IN (select unnest(id_list) FROM " + mainBucket + ") ";

      for (var j = 1; j<i; j++) {
        bucket2 = "bucket" + grids[j];
        sql += " AND cartodb_id NOT IN (select unnest(id_list) FROM " + bucket2 + ") ";
      }

      sql += " GROUP BY ST_SnapToGrid(f.the_geom_webmercator, 0, 0, m.psz * " + sizes[i] + " * <%= size %>, m.psz * " + sizes[i] + " * <%= size %>), m.xmin, m.ymin), ";

    }

    sql +=  bucket + "  AS (SELECT * FROM " + bucket + "_snap WHERE points_count > ";

    if (i == nquartiles - 1) {
      sql += " GREATEST(<%= size %> * 0.1, 2) ";
    } else {
      sql += " <%= size %> * " + sizes[i];
    }

    sql += " ) ";

    if (i < nquartiles - 1) sql += ", ";

  }

  sql += " SELECT the_geom_webmercator, 1 points_count, cartodb_id, ARRAY[cartodb_id] as id_list, 'origin' as src, cartodb_id::text cdb_list FROM filtered_table WHERE ";

  for (var i = 0; i < nquartiles; i++) {
    bucket = "bucket" + grids[i];
    sql += "\n" + (i > 0 ? "AND " : "") + "cartodb_id NOT IN (select unnest(id_list) FROM " + bucket + ") ";
  }

  for (var i = 0; i < nquartiles; i++) {
    bucket = "bucket" + grids[i];
    sql += " UNION ALL SELECT *, '" + bucket + "' as src, array_to_string(id_list, ',') cdb_list FROM " + bucket
  }

  return _.template(sql, {
    name: table.get("name"),
    //size: props["radius_min"],
    size: 48,
    table: "__wrapped"
  });
}

function cluster_generator(table, props, changed, callback) {

  var methodMap = {
    '2 Buckets': 2,
    '3 Buckets': 3,
    '4 Buckets': 4,
    '5 Buckets': 5,
  };

  var grids = ["A", "B", "C", "D", "E"];

  var nquartiles = methodMap[props['method']];
  var table_name = table.get('name');

  var sql = cluster_sql(table, props.zoom, props, nquartiles);

  var c = "#" + table.get('name') + "{\n";
  c += "  marker-width: " + (Math.round(props["radius_min"]/2)) + ";\n";
  c += "  marker-fill: " + props['marker-fill'] + ";\n";
  c += "  marker-line-width: 1.5;\n";

  c += "  marker-opacity: " + props['marker-opacity'] + ";\n";
  c += "  marker-line-opacity: " + props['marker-line-opacity'] + ";\n";
  c += "  marker-line-color: " + props['marker-line-color'] + ";\n";
  c += "  marker-allow-overlap: true;\n";
  c += "  marker-comp-op: dst-atop;\n";

  var base = 20;
  var min = props["radius_min"];
  var max = props["radius_max"];
  var sizes = [min];

  var step = Math.round((max-min)/ (nquartiles - 1));

  for (var i = 1; i < nquartiles - 1; i++) {
    sizes.push(min + step * i);
  }

  sizes.push(max);

  for (var i = 0; i < nquartiles; i++) {
    c += "\n  [src = 'bucket"+grids[nquartiles - i - 1]+"'] {\n";
    c += "    marker-line-width: " + props['marker-line-width'] + ";\n";
    c += "    marker-width: " + sizes[i] + ";\n";
    c += "  } \n";
  }

  c += "}\n\n";

  // Generate label properties
  c += "#" + table.get('name') + "::labels { \n";
  c += "  text-size: 0; \n";
  c += "  text-fill: " + props['text-fill'] + "; \n";
  c += "  text-opacity: 0.8;\n";
  c += "  text-name: [points_count]; \n";
  c += "  text-face-name: '" + props['text-face-name'] + "'; \n";
  c += "  text-halo-fill: " + props['text-halo-fill'] + "; \n";
  c += "  text-halo-radius: 0; \n";

  for (var i = 0; i < nquartiles; i++) {
    c += "\n  [src = 'bucket"+grids[nquartiles - i - 1]+"'] {\n";
    c += "    text-size: " + (i * 5 + 12) + ";\n";
    c += "    text-halo-radius: " + props['text-halo-radius'] + ";";
    c += "\n  }\n";
  }

  c += "\n  text-allow-overlap: true;\n\n";
  c += "  [zoom>11]{ text-size: " + Math.round(props["radius_min"] * 0.66) + "; }\n";
  c += "  [points_count = 1]{ text-size: 0; }\n";
  c += "}\n";

  callback(c, {}, sql);

}

function bubble_generator(table, props, changed, callback) {
  var table_name = table.get('name');
  var carto_props = {
   'marker-fill': props['marker-fill'],
   'marker-line-color': props['marker-line-color'],
   'marker-line-width': props['marker-line-width'],
   'marker-line-opacity': props['marker-line-opacity'],
   'marker-opacity': props['marker-opacity'],
   'marker-comp-op': props['marker-comp-op'],
   'marker-placement': 'point',
   'marker-type': 'ellipse',
   'marker-allow-overlap': true,
   'marker-clip':false,
   'marker-multi-policy':'largest'
  };

  var prop = props['property'];
  var min = props['radius_min'];
  var max = props['radius_max'];
  var fn = carto_functionMap[props['qfunction'] || DEFAULT_QFUNCTION];

  if(/none/i.test(props['marker-comp-op'])) {
    delete carto_props['marker-comp-op'];
  }

  var values = [];

  var NPOINS = 10;
  // TODO: make this related to the quartiles size
  // instead of linear. The circle area should be related
  // to the data and a little correction due to the problems
  // humans have to measure the area of a circle

  //calculate the bubles sizes
  for(var i = 0; i < NPOINS; ++i) {
    var t = i/(NPOINS-1);
    values.push(min + t*(max - min));
  }

  // generate carto
  simple_polygon_generator(table, carto_props, changed, function(css) {
    table.data()[fn](NPOINS, prop, function(quartiles)  {
      for(var i = NPOINS - 1; i >= 0; --i) {
        if(quartiles[i] !== undefined && quartiles[i] != null) {
          css += "\n#" + table_name +" [ " + prop + " <= " + quartiles[i] + "] {\n"
          css += "   marker-width: " + values[i].toFixed(1) + ";\n}"
        }
      }
      callback(css, quartiles);
    });
  });
}

/**
 * when quartiles are greater than 1<<31 cast to float added .01
 * at the end. If you append only .0 it is casted to int and it
 * does not work
 */
function normalizeQuartiles(quartiles) {
  var maxNumber = 2147483648; // unsigned (1<<31);
  var normalized = [];
  for(var i = 0;  i < quartiles.length; ++i) {
    var q = quartiles[i];
    if(q > Math.abs(maxNumber)) {
      q = q + ".01";
    }
    normalized.push(q);
  }
  return normalized;
}

function choropleth_generator(table, props, changed, callback) {
  var type = table.geomColumnTypes() && table.geomColumnTypes()[0] || "polygon";

  var carto_props = manage_choropleth_props(type,props);

  if(props['polygon-comp-op'] && !/none/i.test(props['polygon-comp-op'])) {
    carto_props['polygon-comp-op'] = props['polygon-comp-op'];
  }
  if(props['line-comp-op'] && !/none/i.test(props['line-comp-op'])) {
    carto_props['line-comp-op'] = props['line-comp-op'];
  }
  if(props['marker-comp-op'] && !/none/i.test(props['marker-comp-op'])) {
    carto_props['marker-comp-op'] = props['marker-comp-op'];
  }

  var methodMap = {
    '3 Buckets': 3,
    '5 Buckets': 5,
    '7 Buckets': 7
  };


  if(!props['color_ramp']) {
    return;
  }

  var fn = carto_functionMap[props['qfunction'] || DEFAULT_QFUNCTION];
  var prop = props['property'];
  var nquartiles = methodMap[props['method']];
  var ramp = cdb.admin.color_ramps[props['color_ramp']][nquartiles];
  var table_name = table.get('name');

  if(!ramp) {
    cdb.log.error("no color ramp defined for " + nquartiles + " quartiles");
  }

  simple_polygon_generator(table, carto_props, changed, function(css) {
    table.data()[fn](nquartiles, prop, function(quartiles)  {
      quartiles = normalizeQuartiles(quartiles);
      for(var i = nquartiles - 1; i >= 0; --i) {
        if(quartiles[i] !== undefined && quartiles[i] != null) {
          css += "\n#" + table_name +" [ " + prop + " <= " + quartiles[i] + "] {\n";

          if (type == "line") {
            css += "   line-color: " + ramp[i] + ";\n}"
          } else if (type == "polygon") {
            css += "   polygon-fill: " + ramp[i] + ";\n}"
          } else {
            css += "   marker-fill: " + ramp[i] + ";\n}"
          }
        }
      }
      callback(css, quartiles);
    });
  });
}

function torque_generator(table, props, changed, callback) {
  var carto_props = _.omit(props, [
    'property',
    'torque-duration',
    'torque-frame-count',
    'torque-blend-mode',
    'torque-trails',
    'torque-cumulative',
    'torque-resolution'
  ]);

  var torque_props =
  "Map {\n" +
    [
    '-torque-frame-count:' + props['torque-frame-count'],
    '-torque-animation-duration:' + props['torque-duration'],
    '-torque-time-attribute:"' + props['property'] + '"',
    '-torque-aggregation-function:' + '"count(cartodb_id)"',
    '-torque-resolution:' + props['torque-resolution'],
    '-torque-data-aggregation:' + (props['torque-cumulative'] ? 'cumulative': 'linear')
    ].join(';\n') +
  ";\n}";

  if(props['torque-blend-mode']) {
    carto_props['comp-op'] = props['torque-blend-mode'];
  }


  simple_polygon_generator(table, carto_props, changed, function(css) {
    // add trails
    for (var i = 1; i <= props['torque-trails']; ++i) {
     var trail = "\n#" + table.get('name') + "[frame-offset=" + i  +"] {\n marker-width:" + (props['marker-width'] + 2*i) + ";\n marker-opacity:" + (props['marker-opacity']/(2*i)) +"; \n}";
     css += trail;
    }
    callback(torque_props + "\n\n" + css);
  });


}


/**
 *  New category generator. It replaces Color wizard
 */
function category_generator(table, props, changed, callback) {

  var max_values = 10;
  var others_value = "Others";
  var type = table.geomColumnTypes() && table.geomColumnTypes()[0] || "polygon";
  var table_name = table.get('name');


  // Get fill cartocss parameter
  var fill = 'polygon-fill';
  switch (type) {
    case 'polygon': fill = 'polygon-fill'; break;
    case 'line':    fill = 'line-color'; break;
    default:        fill = 'marker-fill';
  }

  // Generate default styles
  var css = '#' + table_name + " {\n";

  var cartocss_props = manage_carto_properies(props);

  for (var i in cartocss_props) {
    if (i!="categories" && i!="colors" && i!="property") {
      css +=  "   " + i + ": " + props[i] + ";\n";
    }
  }

  // Close defaults
  css += "}\n";

  if (props.colors && !props.categories) {
    colors_to_categories();
  } else if (changed.property || !props.categories || props.categories.length === 0) {
    get_categories();
  } else {
    generate_categories()
  }

  // Transform colors values to categories array
  function colors_to_categories() {
    var colors = [];

    // Generate categories metadata
    for (var i in props.colors) {
      var obj = {};
      var color = props.colors[i];

      obj.title = (i < max_values) ? color[0] : others_value;
      obj.title_type = color[2];
      obj.color = color[1];
      obj.value_type = 'color';

      if (i >= max_values) {
        obj.default = true;
      }

      colors.push(obj);
    }

    generate_categories(colors);
  }

  // Get values with default colors from the sql
  // TODO: move this to tabledata model
  function get_categories() {
    var tmpl = _.template('\
      SELECT <%= column %>, count(<%= column %>) FROM (<%= sql %>) _table_sql ' +
      'GROUP BY <%= column %> ORDER BY count DESC LIMIT ' + (max_values + 1)
    );

    var sql = tmpl({
      sql: table.data().getSQL(),
      table_name: table.get('name'),
      column: props.property
    });

    table.data()._sqlQuery(sql, function(data) {
      var colors = [];
      var column_type = data.fields[props.property].type || 'string';

      // Generate categories metadata
      for (var i in data.rows) {
        var obj = {};

        obj.title = (i < max_values) ? data.rows[i][props.property] : others_value;
        obj.title_type = column_type;
        obj.color = cdb.admin.color_brewer[i];
        obj.value_type = 'color';

        if (i >= max_values) {
          obj.default = true;
        }

        colors.push(obj);
      }

      generate_categories(colors);
    });
  }

  // Generate categories
  function generate_categories(metadata) {
    function _normalizeValue(v) {
      return v.replace(/\n/g,'\\n')
              .replace(/\'/g, "\\'")
              .replace(/\"/g, "\\\"");
    }

    var categories = metadata || props.categories;
    if (categories && table.containsColumn(props.property)) {
      // type of the column, number -> no quotes, string -> quotes, boolean -> no quotes
      for (var i in categories) {

        var category = categories[i][categories[i].value_type];
        var fill = 'polygon-fill';

        switch (type) {
          case 'polygon': fill = (categories[i].value_type == "file") ? 'polygon-pattern-file' : 'polygon-fill'; break;
          case 'line':    fill = (categories[i].value_type == "file") ? 'line-pattern-file' : 'line-color'; break;
          default:        fill = (categories[i].value_type == "file") ? 'marker-file' : 'marker-fill';
        }

        if (categories[i].default) {
          // Default category
          css += "\n#" + table_name + " {\n   " + fill + ": " + category + ";\n}";
        } else {
          // Set correct value type
          var value = '';
          if (categories[i].title_type != "string" || categories[i].title === null) {
            value = categories[i].title;
          } else {
            value = "\"" + _normalizeValue(categories[i].title) + "\"";
          }

          // Custom category
          css += "\n#" + table_name + "[" + props.property + "=" + value + "] {\n   " + fill + ": " + category + ";\n";

          // Trick!
          // When polygon-pattern-file is applied, we have to
          // remove the polygon fill opacity and apply polygon-pattern-opacity (-:(·):-)
          if (type === "polygon" && fill === "polygon-pattern-file") {
            css += "   polygon-opacity:0;\n";
            css += "   polygon-pattern-opacity:" + (props['polygon-opacity'] || 1) + ";\n";
          }

          css += "}";
        }
      }
    }

    callback(css, metadata);
  }
}


function density_sql(table, zoom, props) {
    var prop = 'cartodb_id';
    var sql;

    // we generate a grid and get the number of points
    // for each cell. With that the density is generated
    // and calculated for zoom level 10, which is taken as reference when we calculate the quartiles for the style buclets
    // see models/carto.js
    if(props['geometry_type'] === 'Rectangles') {
      sql = "WITH hgrid AS (SELECT CDB_RectangleGrid(ST_Expand(!bbox!, greatest(!pixel_width!,!pixel_height!) * <%= size %>), greatest(!pixel_width!,!pixel_height!) * <%= size %>, greatest(!pixel_width!,!pixel_height!) * <%= size %>) as cell) SELECT hgrid.cell as the_geom_webmercator, count(i.<%=prop%>) as points_count,count(i.<%=prop%>)/power( <%= size %> * CDB_XYZ_Resolution(<%= z %>), 2 )  as points_density, 1 as cartodb_id FROM hgrid, <%= table %> i where ST_Intersects(i.the_geom_webmercator, hgrid.cell) GROUP BY hgrid.cell";
    } else {
      sql = "WITH hgrid AS (SELECT CDB_HexagonGrid(ST_Expand(!bbox!, greatest(!pixel_width!,!pixel_height!) * <%= size %>), greatest(!pixel_width!,!pixel_height!) * <%= size %>) as cell) SELECT hgrid.cell as the_geom_webmercator, count(i.<%=prop%>) as points_count, count(i.<%=prop%>)/power( <%= size %> * CDB_XYZ_Resolution(<%= z %>), 2 ) as points_density, 1 as cartodb_id FROM hgrid, <%= table %> i where ST_Intersects(i.the_geom_webmercator, hgrid.cell) GROUP BY hgrid.cell";
    }
    return _.template(sql, {
      prop: prop,
      table: '__wrapped',
      size: props['polygon-size'],
      z: zoom
    });
}

/*
 *
 */
function density_generator(table, props, changed, callback) {
  var carto_props = {
   'line-color': props['line-color'],
   'line-opacity': props['line-opacity'],
   'line-width': props['line-width'],
   'polygon-opacity': props['polygon-opacity'],
   'polygon-comp-op': props['polygon-comp-op']
  }

  if(/none/i.test(props['polygon-comp-op'])) {
    delete carto_props['polygon-comp-op'];
  }

  var methodMap = {
    '3 Buckets': 3,
    '5 Buckets': 5,
    '7 Buckets': 7
  };

  var polygon_size = props['polygon-size'];
  var nquartiles = methodMap[props['method']];
  var ramp = cdb.admin.color_ramps[props['color_ramp']][nquartiles];
  var table_name = table.get('name');

  if(!ramp) {
    cdb.log.error("no color ramp defined for " + nquartiles + " quartiles");
  }

  carto_props['polygon-fill'] = ramp[ramp.length - 1];

  var density_sql_gen = density_sql(table, props.zoom, props);

  simple_polygon_generator(table, carto_props, changed, function(css) {

    // density
    var tmpl = _.template("" +
    "WITH clusters as ( " +
    "SELECT  " +
        "cartodb_id,   " +
        "st_snaptogrid(the_geom_webmercator, <%= polygon_size %>*CDB_XYZ_Resolution(<%= z %>)) as center  " +
    "FROM <%= table_name %>" +
    "), " +
    "points as ( " +
        "SELECT  " +
            "count(cartodb_id) as npoints,  " +
            "count(cartodb_id)/power( <%= polygon_size %> * CDB_XYZ_Resolution(<%= z %>), 2 ) as density  " +
        "FROM  " +
            "clusters  " +
        "group by  " +
            "center " +
    "), " +
    "stats as ( " +
        "SELECT  " +
            "npoints,  " +
            "density,  " +
            "ntile(<%= slots %>) over (order by density) as quartile  " +
        "FROM points  " +
    ")  " +
    "SELECT  " +
        "quartile,  " +
        "max(npoints) as maxAmount,  " +
        "max(density) as maxDensity   " +
    "FROM stats  " +
    "GROUP BY quartile ORDER BY quartile ");

    var sql = tmpl({
        slots: nquartiles,
        table_name: table.get('name'),
        polygon_size: polygon_size,
        z: props.zoom
    });

    table.data()._sqlQuery(sql, function(data) {
      // extract quartiles by zoom level
      var rows = data.rows;
      var quartiles = [];
      for(var i = 0; i < rows.length; ++i) {
        quartiles.push(rows[i].maxdensity);
      }

      quartiles = normalizeQuartiles(quartiles);

      css += "\n#" + table_name + "{\n"
      for(var i = nquartiles - 1; i >= 0; --i) {
        if(quartiles[i] !== undefined) {
          css += "  [points_density <= " + quartiles[i] + "] { polygon-fill: " + ramp[i] + ";  }\n";
        }
      }
      css += "\n}"

      callback(css, quartiles, density_sql_gen);
    });
  });
}

cdb.admin.CartoStyles = Backbone.Model.extend({

    defaults: {
      type: 'polygon',
      properties: {
        'polygon-fill': '#FF6600',
        'line-color': '#FFFFFF',
        'line-width': 1,
        'polygon-opacity': 0.7,
        'line-opacity':1
      }
    },

    initialize: function() {
      this.table = this.get('table');

      if (!this.table) {
        throw "table must be passed as param"
        return;
      }

      this.properties = new cdb.core.Model(this.get('properties'));
      this.bind('change:properties', this._generateCarto, this);

      this.generators = {};
      this.registerGenerator('polygon',    simple_polygon_generator);
      this.registerGenerator('cluster',    cluster_generator);
      this.registerGenerator('bubble',     bubble_generator);
      this.registerGenerator('intensity',  intensity_generator);
      this.registerGenerator('choropleth', choropleth_generator);
      this.registerGenerator('color',      category_generator);
      this.registerGenerator('category',   category_generator);
      this.registerGenerator('density',    density_generator); // the same generator than choroplet
      this.registerGenerator('torque',     torque_generator);
    },

    // change a property attribute
    attr: function(name, val) {
      var old = this.attributes.properties[name];
      this.attributes.properties[name] = val;
      if(old != val) {
        this.trigger('change:properties', this, this.attributes.properties);
        this.trigger('changes', this);
      }
    },

    registerGenerator: function(name, gen) {
      this.generators[name] = gen;
    },

    /**
     * generate a informative header
     */
    _generateHeader: function() {
      var typeMap = {
        'polygon': 'simple'
      }
      var t = this.get('type');
      t = typeMap[t] || t;
      var c = "/** " + t + " visualization */\n\n";
      return c;
    },

    regenerate: function() {
      //TODO: apply patch if it's possible
      this._generateCarto();
    },

    _generateCarto: function(){
      var self = this;
      var gen = this.generators[this.get('type')];

      var gen_type = this.get('type');

      if(!gen) {
        cdb.log.error("can't get style generator for " + this.get('type'));
        return;
      }

      // Get changed properties
      var changed = {};
      this.properties.bind('change', function() {
        changed = this.properties.changedAttributes();
      }, this);
      this.properties.set(this.get('properties'));
      this.properties.unbind('change', null, this);
      this.trigger('loading');


      gen(this.table, this.get('properties'), changed, function(style, metadata, sql) {
        if (self.get('type') !== gen_type) {
          return;
        }
        var attrs = {
          style: self._generateHeader() + style
        };

        if(sql) {
          attrs.sql = sql;
        } else {
          self.unset('sql', { silent: true });
        }

        if (metadata) {
          attrs.metadata = metadata;
        }

        self.set(attrs, { silent: true });

        self.change({ changes: {'style': ''}});
        self.trigger('load');
      })
    }

}, {
    DEFAULT_GEOMETRY_STYLE: "{\n // points\n [mapnik-geometry-type=point] {\n    marker-fill: #FF6600;\n    marker-opacity: 1;\n    marker-width: 12;\n    marker-line-color: white;\n    marker-line-width: 3;\n    marker-line-opacity: 0.9;\n    marker-placement: point;\n    marker-type: ellipse;marker-allow-overlap: true;\n  }\n\n //lines\n [mapnik-geometry-type=linestring] {\n    line-color: #FF6600; \n    line-width: 2; \n    line-opacity: 0.7;\n  }\n\n //polygons\n [mapnik-geometry-type=polygon] {\n    polygon-fill:#FF6600;\n    polygon-opacity: 0.7;\n    line-opacity:1;\n    line-color: #FFFFFF;\n   }\n }",
});


/**
 * this class provides methods to parse and extract information from the
 * cartocss like expressions used, filters, colors and errors
 */

cdb.admin.CartoParser = function(cartocss) {
  this.parse_env = null;
  this.ruleset = null;
  if(cartocss) {
    this.parse(cartocss);
  }
}

cdb.admin.CartoParser.prototype = {

  RESERVED_VARIABLES: ['mapnik-geometry-type', 'points_density', 'points_count', 'src', 'value'], // value due to torque

  parse: function(cartocss) {

    var parse_env = this.parse_env = {
      validation_data: true,
      frames: [],
      errors: [],
      error: function(obj) {
        obj.line =  carto.Parser().extractErrorLine(cartocss, obj.index);
        this.errors.push(obj);
      }
    };

    var ruleset = null;
    var defs = null;
    try {
      ruleset = (new carto.Parser(parse_env)).parse(cartocss);
    } catch(e) {
      // add the style.mss string to match the response from the server
      this.parse_env.errors = this._parseError(["style\.mss" + e.message])
      return;
    }
    if(ruleset) {
      defs = ruleset.toList(parse_env);
      for (var i in defs) {
        for (var j in defs[i].rules) {
          var r = defs[i].rules[j].eval(parse_env)
          if(r && r.toXML) {
            r.toXML(parse_env);
          }
        }
      }

      // toList uses parse_env.errors.message to put messages
      if (parse_env.errors.message) {
        _(parse_env.errors.message.split('\n')).each(function(m) {
          parse_env.errors.push(m);
        });
      }
    }
    this.ruleset = ruleset;
    this.definitions = defs;
    return this;
  },

  /**
   * gets an array of parse errors from windshaft
   * and returns an array of {line:1, error: 'string'] with user friendly
   * strings. Parses errors in format:
   *
   *  'style.mss:7:2 Invalid code: asdasdasda'
   */
  _parseError: function(errors) {
    var parsedErrors = [];
    for(var i in errors) {
      var err = errors[i];
      if(err && err.length > 0) {
        var g = err.match(/.*:(\d+):(\d+)\s*(.*)/);
        if(g) {
          parsedErrors.push({
            line: parseInt(g[1], 10),
            message: g[3]
          });
        } else {
          parsedErrors.push({
            line: null,
            message: err
          })
        }
      }
    }
    // sort by line
    parsedErrors.sort(function(a, b) { return a.line - b.line; });
    parsedErrors = _.uniq(parsedErrors, true, function(a) { return a.line + a.message; });
    return parsedErrors;
  },

  /**
   * return the error list, empty if there were no errors
   */
  errors: function() {
    return this.parse_env ? this.parse_env.errors : [];
  },

  _colorsFromRule: function(rule) {
    var self = this;
    function searchRecursiveByType(v, t) {
      var res = []
      for(var i in v) {
        if(v[i] instanceof t) {
          res.push(v[i]);
        } else if(typeof(v[i]) === 'object') {
          var r = searchRecursiveByType(v[i], t);
          if(r.length) {
            res = res.concat(r);
          }
        }
      }
      return res;
    }
    return searchRecursiveByType(rule.eval(this.parse_env), carto.tree.Color);
  },

  _varsFromRule: function(rule) {
    function searchRecursiveByType(v, t) {
      var res = []
      for(var i in v) {
        if(v[i] instanceof t) {
          res.push(v[i]);
        } else if(typeof(v[i]) === 'object') {
          var r = searchRecursiveByType(v[i], t);
          if(r.length) {
            res = res.concat(r);
          }
        }
      }
      return res;
    }
    return searchRecursiveByType(rule, carto.tree.Field);
  },

  /**
   * Extract information from the carto using the provided method.
   * */
  _extract: function(method, extractVariables) {
    var columns = [];
    if (this.ruleset) {
      var definitions = this.ruleset.toList(this.parse_env);
      for (var d in definitions) {
        var def = definitions[d];

         if(def.filters) {
          // extract from rules
          for(var r in def.rules) {
            var rule = def.rules[r];
            var columnList = method(this, rule);
            columns = columns.concat(columnList);
          }

          if (extractVariables) {
            for(var f in def.filters) {
              var filter = def.filters[f];
              if(filter.key) {
                columns.push(filter.key);
              }
          }
        }
      }
    }
    var self = this;
    return _.reject(_.uniq(columns), function(v) {
      return _.contains(self.RESERVED_VARIABLES, v);
    });
    }
  },

  /**
   * return a list of colors used in cartocss
   */
  colorsUsed: function(opt) {

    // extraction method
    var method = function(self, rule) {
      return _.map(self._colorsFromRule(rule), function(f) {
        return f.rgb;
      })
    };

    var colors =  this._extract(method, false);

    if (opt && opt.mode == 'hex') {
      colors = _.map(colors, function(color) {
        return cdb.Utils.rgbToHex(color[0], color[1], color[2]);
      });

    }

    return colors;

  },

  /**
   * return a list of variables used in cartocss
   */
  variablesUsed: function() {

    // extraction method
    var method = function(self, rule) {
      return _.map(self._varsFromRule(rule), function(f) {
        return f.value;
      });
    };

    return this._extract(method, true);
   },

  /**
   * returns the default layer
   */
  getDefaultRules: function() {
    var rules = [];
    for(var i = 0; i < this.definitions.length; ++i) {
      var def = this.definitions[i];
      // all zooms and default attachment so we don't get conditional variables
      if (def.zoom === 8388607 && _.size(def.filters) === 0 && def.attachment === '__default__') {
        rules = rules.concat(def.rules);
      }
    }

    var rulesMap = {};
    for (var r in rules) {
      var rule = rules[r];
      rulesMap[rule.name] = rule;
    }
    return rulesMap;
  },

  getRuleByName: function(definition, ruleName) {
    if (!definition._rulesByName) {
      var rulesMap = definition._rulesByName = {};
      for (var r in definition.rules) {
        var rule = definition.rules[r];
        rulesMap[rule.name] = rule;
      }
    }
    return definition._rulesByName[ruleName];
  }


};

