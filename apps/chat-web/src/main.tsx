import { createRoot } from "react-dom/client";
import { ChatApp } from "./App";
import "./chat.css";

const el = document.getElementById("chat-root");
if (el) createRoot(el).render(<ChatApp />);
