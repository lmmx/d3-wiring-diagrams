height = 500;
width = 1000;
r = 100;
wd_canvas_space = 50;
wd_y_offset = 20;

// var circle_data = [[width / 2, height / 2]];
var circle_data = [];

x = d3.scaleLinear().domain([0, width]).range([0, width]);
y = d3.scaleLinear().domain([0, height]).range([0, height]);

xAxis = d3.axisBottom(x);
// .ticks(((width + 2) / (height + 2)) * 10)
// .tickSize(height)
// .tickPadding(8 - height);

yAxis = d3.axisRight(y);
// .ticks(10)
// .tickSize(width)
// .tickPadding(8 - width);

const svg = d3
  .select("body")
  .append("svg")
  .attr("viewBox", [0, 0, width, height]);

view_debug_opacity = "0.0";
axis_debug_opacity = "0.0";

const view = svg
  .append("rect")
  .attr("class", "view")
  .attr("x", 0.5)
  .attr("y", 0.5)
  .attr("width", width - 1)
  .attr("height", height - 1)
  .attr("style", `opacity: ${view_debug_opacity}`);

const gX = svg
  .append("g")
  .attr("class", "axis axis--x")
  .attr("style", `opacity: ${axis_debug_opacity}`)
  .call(xAxis);
const gY = svg
  .append("g")
  .attr("class", "axis axis--y")
  .attr("style", `opacity: ${axis_debug_opacity}`)
  .call(yAxis);
const wiring_diagram = svg
  .append("g")
  .attr("class", "wiring_diagram")
  .attr("transform", `translate(0,${wd_y_offset})`);

const zoom = d3
  .zoom()
  .scaleExtent([1, 50])
  .translateExtent([
    [0, 0],
    [width, height],
  ])
  .filter(filter)
  .on("zoom", zoomed);

function zoomed({ transform }) {
  view.attr("transform", transform);
  wiring_diagram.attr("transform", transform);
  gX.call(xAxis.scale(transform.rescaleX(x)));
  gY.call(yAxis.scale(transform.rescaleY(y)));
}

function reset() {
  svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
}

Object.assign(svg.call(zoom).node(), { reset });

// prevent scrolling then apply the default filter
function filter(event) {
  event.preventDefault();
  return (!event.ctrlKey || event.type === "wheel") && !event.button;
}

const circles = wiring_diagram
  .selectAll("_")
  .data(circle_data)
  .enter()
  .append("circle")
  .attr("class", "node")
  .attr("r", 2 * r)
  .attr("transform", function (d) {
    return "translate(" + d + ")";
  });

var pack = d3
  .pack()
  .size([width, height - wd_canvas_space])
  .padding(10);

function computed_radius(node) {
  // Uncommenting the ternary operator shrinks with depth
  // return node.depth ? node.r / node.depth : node.r;
  return node.r;
}

function Pack(data) {
  const root = pack(
    d3
      .hierarchy(data)
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value)
  );
  var node = wiring_diagram
    .selectAll(".node")
    .data(root)
    .enter()
    .append("g")
    .attr("class", "node")
    .attr("transform", function (d) {
      return `translate(${d.x},${d.y})`;
    });
  node
    .append("circle")
    .attr("r", function (d) {
      // console.debug("r", d.r, computed_radius(d));
      return computed_radius(d);
    })
    .attr("class", function (d) {
      return d.height ? "parent" : "leaf";
    })
    .attr("data-depth", function (d) {
      return d.depth;
    })
    .attr("data-height", function (d) {
      return d.height;
    })
    .attr("data-value", function (d) {
      return d.value;
    })
    .attr("fill", function (d) {
      return d.children ? "#fff" : "steelblue";
    })
    .attr("opacity", 0.25)
    .attr("stroke", "#ADADAD")
    .attr("stroke-width", 2);
  var label_holder = node.append("g").attr("class", function (d) {
    var is_leaf = d3.select(this.parentNode).select("circle").classed("leaf");
    return "label-box" + (is_leaf ? " leafy" : " parental");
  });
  var label = label_holder.append("text");
  label.text(function (d) {
    return d.data.name;
  });
  label.attr("data-scale_factor", function (d) {
    text_bbox = this.getBBox(); // bounding client rect misbehaves
    factor = fit_label_to_diameter(d, text_bbox);
    return factor > -0.2 ? "1.0" : 1.0 - factor;
  });
  label.attr("style", function (d) {
    var scale = this.dataset.scale_factor;
    // console.log(`Scale: ${scale}`);
    return `font-size: ${scale}rem`;
  });
  label.attr("data-width", function (d) {
    return this.getBBox().width; // same as getComputedTextLength
  });
  label.attr("data-height", function (d) {
    return this.getBBox().height;
  });
  label.attr("class", "label").attr("data-transform", function (d) {
    text_width = this.dataset.width;
    text_height = this.dataset.height;
    text_bbox = this.getBBox(); // bounding client rect misbehaves
    downscale_factor = fit_label_to_diameter(d, text_bbox);
    var x_shift = -(text_width / 2); // * downscale_factor;
    var depth_direction = d.depth ? -1 : 1; // module name goes below
    var y_shift = d.children
      ? depth_direction * computed_radius(d)
      : text_height / 4; // * downscale_factor;
    var data_transform = [x_shift, y_shift];
    return data_transform;
  });
  label.attr("class", "label").attr("transform", function (d) {
    [x_shift, y_shift] = this.dataset.transform.split(",");
    return `translate(${x_shift},${y_shift})`;
  });
  label_holder
    .insert("rect", "text")
    .attr("fill", function (holder) {
      var is_par = d3.select(this.parentNode).classed("parental");
      return is_par ? "white" : "none";
    })
    .attr("width", function (holder) {
      return d3.select(this.parentNode).select("text").attr("data-width");
    })
    .attr("height", function (holder) {
      return d3.select(this.parentNode).select("text").attr("data-height");
    })
    .attr("transform", function (holder) {
      label = d3.select(this.parentNode).select("text");
      [x_shift, y_shift] = label.attr("data-transform").split(",");
      y_shift = parseFloat(y_shift) - wd_y_offset;
      return `translate(${x_shift},${y_shift})`;
    });
}

function fit_label_to_diameter(node, bbox) {
  scaling_threshold = 0.2; // ignore anything below this
  diameter = computed_radius(node) * 2;
  tightening_factor = (bbox.width - diameter) / diameter;
  // console.log(`Computed a scaling factor of ${tightening_factor}`, node, bbox);
  return tightening_factor;
}

var data;
var promised = d3.json("wd_sample_data.json").then(
  function (fetched) {
    // console.log(fetched);
    data = fetched;
    Pack(data);
  },
  function (failed) {
    console.debug("Fetch failed, falling back to stored JSON string");
    data = JSON.parse(
      '{"name":"module.py","children":[{"name":"bar()","value":1},{"name":"Foo","children":[{"name":"a(self, x, y)","value":3},{"name":"b(self, x)","value":2},{"name":"c(cls, x)","value":2},{"name":"d(self)","value":1}]}]}'
    );
    Pack(data);
  }
);
