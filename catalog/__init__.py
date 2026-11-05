"""Dashboard-only package; no agent tools, hooks or middleware."""


def register(ctx):
    # Hermes 0.22.6's validator requires an agent entrypoint beside plugin.yaml.
    pass
