import axios, { AxiosInstance } from "axios";

let clientInstance: AxiosInstance | null = null;

async function getClient(): Promise<AxiosInstance> {
  if (!clientInstance) {
    clientInstance = axios.create({
      withCredentials: true,
      maxRedirects: 15,
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
      },
    });
  }
  return clientInstance;
}

export const httpClient = {
  async head(url: string, config?: any) {
    const client = await getClient();
    return client.head(url, config);
  },
  async get(url: string, config?: any) {
    const client = await getClient();
    return client.get(url, config);
  },
};
