interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const worker = {
  fetch(request: Request, env: Env) {
    return env.ASSETS.fetch(request);
  }
};

export default worker;
