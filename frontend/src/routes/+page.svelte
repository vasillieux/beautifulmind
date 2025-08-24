<script lang="ts">
	import { onMount } from 'svelte';
	import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
	import { BeautifulMindClient } from '$lib/proto/beautifulmind.client';
	import type { SessionState, Card } from '$lib/proto/beautifulmind';
	import katex from 'katex';
	import 'katex/dist/katex.min.css';

	let state: 'connecting' | 'menu' | 'session' | 'error' = 'connecting';
	let errorMessage = '';

	const transport = new GrpcWebFetchTransport({ baseUrl: "http://localhost:50051" });
	const client = new BeautifulMindClient(transport);
	
	let thesisOptions: Card[] = [];
	let session: SessionState | null = null;
	
	async function loadTheses() {
		try {
			const { response } = await client.listTheses({});
			thesisOptions = response.theses;
			state = 'menu';
		} catch (e: any) {
			console.error("Failed to connect to backend. Is it running?", e);
			errorMessage = 'Could not connect to the Go backend. Make sure it is running in a separate terminal via `./beautifulmind serve`.';
			state = 'error';
		}
	}

	async function startSession(thesisId: string) {
		const { response } = await client.startSession({ thesisId });
		session = response;
		state = 'session';
	}

	async function processInput(key: string) {
		if (!session) return;
		const { response } = await client.processInput({ key });
		session = response;
	}

	onMount(() => {
		setTimeout(loadTheses, 500);
	});

	// function to render latex math
	function renderMath(node: HTMLElement) {
		const text = node.innerHTML;
		const rendered = text.replace(/\$\$(.*?)\$\$/g, (match, latex) => {
			try {
				return katex.renderToString(latex, { throwOnError: false, displayMode: true });
			} catch (e) { return match; }
		});
		node.innerHTML = rendered;
	}
</script>

<main class="container">
	{#if state === 'connecting'}
		<h1>connecting to beautiful mind engine...</h1>
	{:else if state === 'error'}
		<div class="panel error">
			<h1>connection error</h1>
			<p>{errorMessage}</p>
		</div>
	{:else if state === 'menu'}
		<h1>Select a Thesis to Begin</h1>
		<div class="menu">
			{#each thesisOptions as thesis}
				<button class="menu-item" on:click={() => startSession(thesis.id)}>
					<strong>{thesis.title}</strong>
					<span class="faint">from deck '{thesis.deckId}'</span>
				</button>
			{/each}
		</div>
	{:else if state === 'session' && session && session.currentCard}
		<div class="panel interaction">
			<p class="faint">THESIS: {session.thesis?.content}</p>
			<hr />
			
			{#if !session.isEvidenceRevealed}
				<h4>EVIDENCE: {session.currentCard.title}</h4>
				<p class="faint">[ what is the content of this card? ]</p>
				<button on:click={() => processInput('enter')}>Reveal</button>
			{:else}
				<h4>EVIDENCE: {session.currentCard.title}</h4>
				<div use:renderMath>
					{@html session.currentCard.content}
				</div>
				<div class="controls">
					<button on:click={() => processInput('up')}>Supports</button>
					<button on:click={() => processInput('down')}>Refutes</button>
				</div>
			{/if}
		</div>
	{/if}
</main>

<style>
	:global(body) { background: #1a1a1a; color: #eee; font-family: sans-serif; }
	.container { max-width: 900px; margin: 2rem auto; }
	.panel { background: #2a2a2a; border: 1px solid #444; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
	.error { border-color: #800; }
	.faint { opacity: 0.6; font-size: 0.9em; }
	.controls { margin-top: 1.5rem; }
	button { background: #4a4a4a; color: #eee; border: none; padding: 0.75rem 1.25rem; border-radius: 4px; cursor: pointer; margin-right: 0.5rem; }
	button:hover { background: #5a5a5a; }
	.menu-item { display: block; width: 100%; text-align: left; margin-bottom: 0.5rem; background: #333; }
	.menu-item strong { display: block; margin-bottom: 0.25rem; font-size: 1.1em; }
</style>