import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { ErrorBoundary, Root } from "./root";
import Home from "./routes/home";
import Runs from "./routes/runs";
import "./app.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, element: <Home /> },
      { path: "runs", element: <Runs /> },
      { path: "runs/:issue", element: <Runs /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
