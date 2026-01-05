import React from "react";
import ReactApexChart from "react-apexcharts";

export function TemperatureChart() {
  const data = {
    series: [
      {
        name: "Temperature",
        data: [72, 75, 78, 76, 74, 73, 70, 68, 72, 75],
      },
    ],
    options: {
      chart: {
        type: "line",
        height: 300,
        toolbar: {
          show: false,
        },
      },
      xaxis: {
        categories: [
          "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "24:00"
        ],
      },
      yaxis: {
        title: {
          text: "Temperature (°F)",
        },
      },
      colors: ["#4CAF50"],
      stroke: {
        curve: "smooth",
      },
    },
  };

  return (
    <div className="bg-black p-4 rounded-lg w-full max-w-xl">
      <h3 className="text-white mb-2">Temperature Chart</h3>
      <ReactApexChart
        options={data.options}
        series={data.series}
        type="line"
        height={300}
      />
    </div>
  );
}
