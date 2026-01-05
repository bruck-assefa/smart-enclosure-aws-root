import React from "react";

export function LightTimes({ onTime = "06:00", offTime = "20:00" }) {
  return (
    <div className="bg-black text-white p-4 rounded-lg w-full flex justify-between">
      <span>On Time: {onTime}</span>
      <span>Off Time: {offTime}</span>
    </div>
  );
}
