import bodyParser from "body-parser";
import express from "express";
import axios from "axios";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Node state
  let state = {
    killed: false,
    x: isFaulty ? null : initialValue,  // If faulty, x = null
    decided: isFaulty ? null : false,   // If faulty, decided = null
    k: isFaulty ? null : 0,             // If faulty, k = null
  };

  // Status route
  node.get("/status", (req, res) => {
    if (isFaulty) {
      return res.status(500).send("faulty");
    } else {
      return res.status(200).send("live");
    }
  });

  let receivedMessages: number[] = [];

  // Message route
  node.post("/message", (req, res) => {
    if (state.killed || state.decided) {
      return res.status(200).send("Node stopped or already decided");
    }

    const { value, round } = req.body;

    // Only accept messages for the current round
    if (round === state.k) {
      receivedMessages.push(value);
      return res.status(200).send("Message received");
    }

    return res.status(400).send("Invalid round");
  });

  // Start route
  node.get("/start", async (req, res) => {
    if (state.killed || state.decided) {
      return res.status(200).send("Node stopped or already decided");
    }
    
    while (!nodesAreReady()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }   

    while (!state.decided) {
      receivedMessages = [];

      // Broadcast current value to all nodes
      for (let i = 0; i < N; i++) {
        if (i !== nodeId) { // Don't send to self
          await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            value: state.x,
            round: state.k,
          });
        }
      }

      // Wait for messages to arrive (simulate network delay)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Count occurrences of 0 and 1
      let count0 = receivedMessages.filter((v) => v === 0).length;
      let count1 = receivedMessages.filter((v) => v === 1).length;
      let majorityThreshold = Math.floor(N / 2) + 1;

      // Majority decision
      if (count0 >= majorityThreshold) {
        state.x = 0;
      } else if (count1 >= majorityThreshold) {
        state.x = 1;
      } else {
        // No clear majority, apply randomness
        state.x = Math.random() < 0.5 ? 0 : 1;
      }

      // If a strict majority exists, decide
      if (count0 >= majorityThreshold || count1 >= majorityThreshold) {
        state.decided = true;
        break;
      }

      // Move to next round
      if (state.k !== null) {
        state.k++;
      }
    }

    return res.status(200).send("Consensus reached");
  });

  // Stop route
  node.get("/stop", (req, res) => {
    state.killed = true;
    res.status(200).send("Node stopped");
  });

  // Get node state
  node.get("/getState", (req, res) => {
    res.json(state);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
