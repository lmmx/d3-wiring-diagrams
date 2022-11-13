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
  .attr("r", 2 * r)
  .attr("transform", function (d) {
    return "translate(" + d + ")";
  });

var pack = d3
  .pack()
  .size([width, height - 50])
  .padding(10);

d3.json("wd_sample_data.json", function (data) {
  var nodes = pack.nodes(data);
});
