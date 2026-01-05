import React from 'react';
import { Sensor } from "./Sensor";

export function SensorsSection() {
  const sensorData = [
    { sensorID: "0", zone: "Hot", temp: "98.5", humidity: "25", pressure: "1008.2" },
    { sensorID: "1", zone: "Warm", temp: "92.3", humidity: "30", pressure: "1010.1" },
    { sensorID: "2", zone: "Transition", temp: "87.4", humidity: "35", pressure: "1005.7" },
    { sensorID: "3", zone: "Cool", temp: "81.2", humidity: "40", pressure: "1006.3" },
    { sensorID: "4", zone: "Cold", temp: "76.8", humidity: "45", pressure: "1007.9" },
    { sensorID: "5", zone: "Cold Corner", temp: "72.5", humidity: "50", pressure: "1012.5" },
    { sensorID: "6", zone: "Shade", temp: "68.9", humidity: "55", pressure: "1011.2" },
    { sensorID: "7", zone: "Ambient", temp: "70.0", humidity: "60", pressure: "1009.6" },
  ];

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold mb-2">Sensors</h3>
      {sensorData.map((sensor, index) => (
        <Sensor
          sensorID={sensor.sensorID}
          zone={sensor.zone}
          temp={sensor.temp}
          humidity={sensor.humidity}
          pressure={sensor.pressure}
        />
      ))}
    </div>
  );
}
