// The overlay's only way to anything: the runtime's authenticated local
// interface. It holds the token and nothing else; every decision is the
// runtime's.

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

namespace MiniBot
{
    public class ApiException : Exception
    {
        public int Status;
        public ApiException(int status, string message) : base(message) { Status = status; }
    }

    public class Api
    {
        readonly HttpClient http;
        readonly string baseUrl;

        public Api(string url, string token)
        {
            baseUrl = url;
            http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(3);
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        public Dictionary<string, object> Get(string path)
        {
            return Send(HttpMethod.Get, path, null);
        }

        public Dictionary<string, object> Post(string path, object body)
        {
            return Send(HttpMethod.Post, path, body ?? new Dictionary<string, object>());
        }

        /// <summary>One named change to the configuration (create, select, rename, delete, update, settings, move).</summary>
        public Dictionary<string, object> Apply(Dictionary<string, object> op)
        {
            return Post("/v1/config/apply", op);
        }

        Dictionary<string, object> Send(HttpMethod method, string path, object body)
        {
            string text;
            int status;
            try
            {
                var request = new HttpRequestMessage(method, baseUrl + path);
                if (body != null) request.Content = new StringContent(Json.Write(body), Encoding.UTF8, "application/json");
                var response = http.SendAsync(request).GetAwaiter().GetResult();
                text = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                status = (int)response.StatusCode;
            }
            catch (Exception)
            {
                throw new ApiException(0, "The companion is not reachable.");
            }
            var parsed = Json.Parse(text);
            if (status < 200 || status > 299) throw new ApiException(status, Json.Str(parsed, "error", "The request failed."));
            return parsed;
        }
    }
}
