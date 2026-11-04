import { createFileRoute } from "@tanstack/react-router";
import { GameApp } from "@/components/forca/game-app";

export const Route = createFileRoute("/")({ component: GameApp });
