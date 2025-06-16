<script>
  import { accessToken } from "./store.js";
  import { createEventDispatcher } from "svelte";

  export let type = "login"; // "login" ou "register"

  const dispatch = createEventDispatcher();

  $: title = type === "login" ? "Login" : "Register";

  let email = "";
  let password = "";
  let confirmPassword = "";
  let successMessage = ""; // Variable pour stocker le message de succès
  let errorMessage = ""; // Variable pour stocker le message d'erreur

  const handleSubmit = async (event) => {
    errorMessage = "";
    event.preventDefault();
    successMessage = ""; // Réinitialiser le message de succès

    if (type === "register" && password !== confirmPassword) {
      errorMessage = "Passwords do not match"; // Mettre à jour le message d'erreur
      return;
    }

    const apiUrl = `${import.meta.env.VITE_API_URL}/${type}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      const data = await response.json();
      accessToken.set(data.access_token);
      successMessage = "Success"; // Mettre à jour le message de succès
      console.log(`Success ${type}`);
      setTimeout(() => {
        dispatch("changeView", { view: type === "login" ? "tabs" : "login" });
      }, 1000);
    } else {
      const data = await response.json();
      errorMessage = `Error ${data.status}: ${data.message}`;
      console.error("HTTP error", data);
    }
  };
</script>

<div class="auth-container">
  <h1>{title}</h1>
  <form
    on:submit={handleSubmit}
    on:focus={() => {
      errorMessage = "";
    }}
  >
    <div class="input-group">
      <label for="email">Email</label>
      <input
        type="email"
        id="email"
        name="email"
        bind:value={email}
        required
        on:focus={() => {
          errorMessage = "";
        }}
      />
    </div>
    <div class="input-group">
      <label for="password">Password</label>
      <input
        type="password"
        id="password"
        name="password"
        bind:value={password}
        required
        on:focus={() => {
          errorMessage = "";
        }}
      />
    </div>
    {#if type === "register"}
      <div class="input-group">
        <label for="confirm-password">Confirm Password</label>
        <input
          type="password"
          id="confirm-password"
          name="confirm-password"
          bind:value={confirmPassword}
          required
          on:focus={() => {
            errorMessage = "";
          }}
        />
      </div>
    {/if}
    <button type="submit">{title}</button>
  </form>
  {#if successMessage}
    <p class="success-message">{successMessage}</p>
    <!-- Afficher le message de succès -->
  {/if}
  {#if errorMessage}
    <p class="error-message">{errorMessage}</p>
    <!-- Afficher le message de succès -->
  {/if}
  {#if type === "login"}
    <p>
      No account? <a
        href="#"
        on:click|preventDefault={() => (type = "register")}>Register here</a
      >
    </p>
  {:else}
    <p>
      Already have an account? <a
        href="#"
        on:click|preventDefault={() => (type = "login")}>Login here</a
      >
    </p>
  {/if}
</div>

<style>
  .auth-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
  }
  .input-group {
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .input-group label {
    margin-bottom: 0.5rem;
  }
  .input-group input {
    width: 100%;
    padding: 0.5rem;
    box-sizing: border-box;
  }
  button {
    padding: 0.5rem 1rem;
    cursor: pointer;
  }
  .success-message {
    color: green;
    margin-top: 1rem;
  }
  .error-message {
    color: red;
    margin-top: 1rem;
  }
</style>
