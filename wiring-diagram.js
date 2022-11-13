height = 500;
width = 1000;
r = 100;

var circle_data = [[width / 2, height / 2]];

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
const pod = svg.append("g").attr("class", "pod");

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
  pod.attr("transform", transform);
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

const circles = pod
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
  .size([width, height - 50])
  .padding(10);

function computed_radius(node) {
  return node.r / node.depth;
}

function Pack(data) {
  const root = pack(
    d3
      .hierarchy(data)
      .sum((d) => d.value)
      .sort((a, b) => b.value - a.value)
  );
  var node = pod
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
      console.log("r", d.r, computed_radius(d));
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
  // node.append("text").text("Hello");
  var label = node.append("text");
  label.text(function (d) {
    return d.data.name;
  });
  label.attr("class", "label").attr("transform", function (d) {
    text_bbox = this.getBBox(); // bounding client rect misbehaves
    text_width = text_bbox.width; // same as getComputedTextLength
    text_height = text_bbox.height;
    var x_shift = -text_width / 2;
    var y_shift = d.children ? -computed_radius(d) : text_height / 4;
    return `translate(${x_shift},${y_shift})`;
  });
}

// d3.json("wd_sample_data.json", Pack)
data = JSON.parse(
  '{"name":"mymodule.py","children":[{"name":"hello","value":25},{"name":"foo","children":[{"name":"foo1","value":30},{"name":"foo2","value":23},{"name":"foo3","value":33},{"name":"foo4","value":39},{"name":"foo5","value":20}]}]}'
);
Pack(data);
