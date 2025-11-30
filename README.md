# 🌱 EcoCompute — Decentralized Browser-Based Compute Network

EcoCompute is a fully browser-powered decentralized computing system where users can share their idle CPU/GPU resources to collaboratively process computational jobs.  
Instead of relying on centralized servers or expensive cloud GPUs, EcoCompute distributes tasks directly between users — **right inside the browser** using JavaScript, Web Workers, and localStorage.

EcoCompute demonstrates how compute markets like Render, Golem, or BOINC can be simulated in a lightweight, accessible environment without needing backend servers or blockchain infrastructure (yet).

---

# 📘 Introduction

Modern computational workloads — such as matrix multiplications, image transformations, video processing, and scientific simulations — require substantial processing power. Traditional solutions depend on centralized cloud systems which are expensive and often inaccessible to students, researchers, and small startups.

**EcoCompute solves this by enabling distributed computing natively in the browser.**

Users can either:

- Become **Recruiters**, submitting computational tasks  
- Become **Providers**, sharing their CPU power to process micro-tasks  

The system automatically splits a large job into micro-tasks, distributes them across devices, gathers the results, and reconstructs the final output — all with **zero backend**.

---

# ⚙️ How EcoCompute Works

EcoCompute follows a simple yet powerful workflow:

### **1. Recruiter Submits a Job**
Recruiters create computational jobs using:
- Text or JSON input  
- File upload  
- Matrix A & Matrix B (for distributed matrix multiplication)  

They choose:
- Chunk size  
- Redundancy  
- Priority  
- Budget (optional)  

The job is then **split automatically into microtasks**, stored locally in `localStorage`.

---

### **2. Microtask Generation**
Depending on the job type, EcoCompute creates microtasks such as:

#### ✔ Array Jobs  
Split N items → microtasks of size `chunkSize`.

#### ✔ Matrix Multiplication Jobs  
Break matrix A into rows:


Each provider computes one row of the output matrix.

---

### **3. Providers Join the Network**
Providers see:
- CPU benchmark score  
- Battery % + charging condition  
- Worker pool size  
- Assigned / Running / Completed tasks  
- Earned points  

Workers then:
1. Automatically fetch pending microtasks  
2. Compute them using browser Web Workers  
3. Save results back to job data  
4. Earn points based on workload + benchmark score  

---

### **4. Job Completion**
Once all microtasks return results:
- EcoCompute merges them  
- Marks job as complete  
- Recruiter can download final JSON output  

---

# ✨ Features

### 🟩 **Recruiter Features**
- Create new computational jobs  
- JSON / Text input support  
- File upload support  
- Separate Matrix A/B mode  
- Real-time job management  
- Microtask visualization  
- Job logs & status tracking  
- Download aggregated results  

---

### 🟦 **Provider Features**
- CPU benchmarking  
- Battery-safety checks  
- Worker pool (parallel Web Worker execution)  
- Automatic task assignment  
- Real-time logs  
- A live points/rewards system  
- Contribution history tracking  

---

### 🟨 **Core System Features**
- Fully decentralized — no backend  
- Deterministic microtask generation  
- Real-time job updates  
- Robust localStorage job database  
- Row-based distributed matrix multiplication  
- Safe JSON serialization for results  
- Result aggregation engine  

---

# 🌍 Impact

EcoCompute highlights how distributed computation can be:

### **Accessible**  
Runs on any device with a browser — no downloads, no setup, no GPU required.

### **Efficient**  
Uses idle compute cycles on everyday devices.

### **Educational**  
Helps students understand:
- Distributed computing  
- Parallel processing  
- Task scheduling  
- Worker pools & microtasks  
- Matrix multiplication workloads  

### **Scalable (in the future)**  
Can evolve into a real compute marketplace for:
- AI inference  
- Image generation  
- ML training  
- Scientific simulation tasks  

EcoCompute demonstrates the potential of **community-powered computing**, lowering reliance on centralized data centers.

---

# 📌 Summary

EcoCompute is:
- A decentralized compute network  
- Running entirely in the browser  
- With recruiters creating tasks  
- Providers computing microtasks  
- Results aggregated automatically  
- Zero backend required  
- Fully transparent and extensible  
- Equipped with rewards, statistics, and logs

This project showcases the power of JavaScript and browser APIs in building complex distributed systems.

---

# 🔮 Future Plans

EcoCompute is designed with expansion in mind. Upcoming enhancements may include:

### 🔥 **1. WebGPU Support**
- True GPU-based matrix multiplications  
- ML inference  
- Stable Diffusion–style workloads  

### 🔗 **2. Blockchain Integration**
- On-chain identity & reputation  
- Tokenized rewards  
- Secure task verification  
- Decentralized compute marketplace  

### 🗄️ **3. Backend + Cloud Sync**
- Shared global job pool  
- Multi-user environment  
- Persistent storage for jobs & results  

### 🛡️ **4. Verification & Security**
- Redundant execution (R=2 or R=3)  
- Result hashing  
- Majority-validation consensus  

### 🎖️ **5. Gamification**
- Global leaderboard  
- Achievements  
- Social profiles  
- Weekly competitions  

### 📦 **6. Advanced Job Types**
- Image convolutions  
- Audio processing chunks  
- Video frame microtasks  
- AI model inference tiles  

EcoCompute can grow into a **full decentralized compute marketplace** — powered by community devices, accessible from any browser.


live website link - https://eco-compute.onrender.com


