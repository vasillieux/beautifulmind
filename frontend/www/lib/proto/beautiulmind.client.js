import { BeautifulMind } from "./beautiulmind";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
/**
 * the services our beautiful mind engine provides
 *
 * @generated from protobuf service beautifulmind.BeautifulMind
 */
export class BeautifulMindClient {
    _transport;
    typeName = BeautifulMind.typeName;
    methods = BeautifulMind.methods;
    options = BeautifulMind.options;
    constructor(_transport) {
        this._transport = _transport;
    }
    /**
     * @generated from protobuf rpc: ListTheses
     */
    listTheses(input, options) {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: StartSession
     */
    startSession(input, options) {
        const method = this.methods[1], opt = this._transport.mergeOptions(options);
        return stackIntercept("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: ProcessInput
     */
    processInput(input, options) {
        const method = this.methods[2], opt = this._transport.mergeOptions(options);
        return stackIntercept("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: AddCard
     */
    addCard(input, options) {
        const method = this.methods[3], opt = this._transport.mergeOptions(options);
        return stackIntercept("unary", this._transport, method, opt, input);
    }
}
