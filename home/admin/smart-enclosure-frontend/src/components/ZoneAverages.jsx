import React from "react";
import { TemperatureCard } from "./TemperatureCard";

export function ZoneAverages({ zones }) {
  return (
    <div className="flex justify-center items-center w-full gap-4">
      {zones.map((zone, index) => (
        <TemperatureCard key={index} zone={zone.name} temperature={zone.temperature} />
      ))}
    </div>
  );
}
