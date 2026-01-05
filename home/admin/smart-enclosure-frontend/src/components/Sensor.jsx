import React from "react";

export function Sensor({
  sensorID = "2",
  zone = "Transition",
  temp = "22.12",
  humidity = "41",
  pressure = "1104.2"
}) {
  return (
    <div className="text-white w-full grid grid-cols-[1fr_3fr_2fr_1fr_2fr] border border-gray-600 px-2 py-1 text-sm">
      <div className="">
        <div className="text-xs text-gray-400">ID:</div>
        <div className="text-lg text-white">{sensorID}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Zone:</div>
        <div className="text-lg text-white">{zone}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Temp:</div>
        <div className="text-lg text-white">{temp}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Humidity:</div>
        <div className="text-lg text-white">{humidity}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">Pressure:</div>
        <div className="text-lg text-white">{pressure}</div>
      </div>
    </div>
  );
}
