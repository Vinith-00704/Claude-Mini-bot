// Fetches computer control's jobs from the runtime and carries them out, one at a time, on a thread of
// its own, so a slow window (or a wait Claude asked for) never freezes the bot. It asks for work only
// while control is on.

using System;
using System.Collections.Generic;
using System.Threading;

namespace MiniBot
{
    class ControlWorker : IDisposable
    {
        readonly Api api;
        readonly ComputerHands hands;
        readonly Thread thread;
        volatile bool active;
        volatile bool stopping;

        public ControlWorker(Api api, ComputerHands hands)
        {
            this.api = api;
            this.hands = hands;
            thread = new Thread(Loop) { IsBackground = true, Name = "Computer control" };
            // Windows' accessibility interface is meant to be called from a thread like this one, not the window thread.
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        /// <summary>Whether there may be work: true while control is asked for, running or paused.</summary>
        public bool Active { set { active = value; } }

        void Loop()
        {
            while (!stopping)
            {
                if (!active) { Thread.Sleep(200); continue; }
                object[] jobs;
                try { jobs = Json.Arr(api.Overlay("/v1/computer/jobs", null), "jobs"); }
                catch (ApiException) { Thread.Sleep(500); continue; }
                if (jobs.Length == 0) { Thread.Sleep(50); continue; }
                foreach (var raw in jobs)
                {
                    var job = raw as Dictionary<string, object>;
                    if (job == null) continue;
                    var report = new Dictionary<string, object> { { "id", Json.Str(job, "id") } };
                    try
                    {
                        report["data"] = hands.Run(Json.Str(job, "kind"), Json.Obj(job, "args"));
                        report["ok"] = true;
                    }
                    catch (StepException e) { report["ok"] = false; report["error"] = e.Message; }
                    catch (Exception e)
                    {
                        App.Log("computer control: " + e);
                        report["ok"] = false;
                        report["error"] = "The bot could not do that (" + e.GetType().Name + ").";
                    }
                    try { api.Overlay("/v1/computer/result", report); }
                    catch (ApiException e) { App.Log("computer control: could not report: " + e.Message); }
                }
            }
        }

        public void Dispose()
        {
            stopping = true;
        }
    }
}
