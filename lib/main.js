/*jshint esversion: 6 */
var fs          = require("fs"),
    zlib        = require("zlib"),
    assert      = require("assert");

const STATE = {
    NONE:           "NONE",
    ERROR:          "ERROR",
    DATA_START:     "DATA_START",
    DATA_CONTINUE:  "DATA_CONTINUE"
};

const TYPE = {
    INT8:           1,
    UINT8:          2,
    INT16:          3,
    UINT16:         4,
    INT32:          5,
    UINT32:         6,
    SINGLE:         7,
    DOUBLE:         9,
    INT64:          12,
    UINT64:         13,
    MATRIX:         14,
    COMPRESSED:     15,
    UTF8:           16,
    UTF16:          17,
    UTF32:          18
};

const MATRIX_FLAGS = {
    COMPLEX:        1>>5,
    GLOBAL:         1>>6,
    LOGICAL:        1>>7
};

function _validType(t) {
    var result = false;
    for (var v in TYPE) {
        if (TYPE[v] === t) {
            result = true;
            break;
        }
    }
    return result;
}

function _ctx(d, o, t, l) {
    return {
        data: d,
        offset: o,
        type: t,
        length: l
    };
}

function BinaryFileReader(filename) {
    this._filename = filename;
    this._state = STATE.NONE;
    this._useBE = false;
    this._metastack = []; /* used internally by the _parseData to store the state. */
    this._meta = {}; /* points to the current meta in the stack. */

    /* datatype readers. will be generated once the format of the file is known,
     * i.e. after parsing the header. */
    this._readDouble        = function () { throw new Error("Called too early."); };
    this._readFloat         = function () { throw new Error("Called too early."); };
    this._readInt8          = function () { throw new Error("Called too early."); };
    this._readInt16         = function () { throw new Error("Called too early."); };
    this._readInt32         = function () { throw new Error("Called too early."); };
    this._readInt64         = function () { throw new Error("Called too early."); };
    this._readUInt8         = function () { throw new Error("Called too early."); };
    this._readUInt16        = function () { throw new Error("Called too early."); };
    this._readUInt32        = function () { throw new Error("Called too early."); };
    this._readUInt64        = function () { throw new Error("Called too early."); };
}

BinaryFileReader.prototype = Object.create(null);
BinaryFileReader.prototype.constuctor = BinaryFileReader;

/* description of datatype readers. it is used to generate the readers once the
 * file format (BE or LE) is known. */
var _readers = [
    {
        id:       "readFloat",
        length:   4
    },
    {
        id:       "readDouble",
        length:   8
    },
    {
        id:       "readInt8",
        length:   1
    },
    {
        id:       "readInt16",
        length:   2
    },
    {
        id:       "readInt32",
        length:   4
    },
    {
        id:       "readInt64",
        length:   8
    },
    {
        id:       "readUInt8",
        length:   1
    },
    {
        id:       "readUInt16",
        length:   2
    },
    {
        id:       "readUInt32",
        length:   4
    },
    {
        id:       "readUInt64",
        length:   8
    }
];

/*
 * Depending on whether the file is in BE or LE, generate the datatype readers
 * proper to the file format.
 */
BinaryFileReader.prototype._generateDatatypeReaders = function () {
    var desc,
        suffix = this._useBE ? "BE" : "LE";

    var _generateReader = function (d) {
        var name = "_" + d.id,
            nodeName = d.id + suffix;
        this[name] = function (ctx) {
            var result = ctx.data[nodeName](ctx.offset);
            ctx.offset += d.length;
            return result;
        };
    }.bind(this);

    for (desc in _readers) {
        _generateReader(_readers[desc]);
    }
};

BinaryFileReader.prototype._readFileHeader = function (hdr) {
    var text = Buffer.from(hdr.buffer, 0, 116).toString().trim(),
        subsys = Buffer.from(hdr.buffer, 116, 8),
        version = Buffer.from(hdr.buffer, 124, 2),
        endianBytes = hdr.readInt16BE(126),
        b1,
        b2,
        hasSubsysOffset = false;

    // subsystem hdr offset field
    for (var v of subsys.values()) {
        if (v !== 0 && v !== 0x20) {
            hasSubsysOffset = true;
            break;
        }
    }
    // endianness indicator
    b1 = endianBytes & 0xff;
    b2 = (endianBytes >> 8) & 0xff;
    if (b1 === 0x49 && b2 === 0x4d) { /* read IM */
        this._useBE = true;
    } else if (b1 === 0x4d && b2 === 0x49) { /* read MI */
        this._useBE = false;
    } else { /* broken file format or our bug */
        process.stderr.write("Error parsing endian indicator: 0x" + b1.toString(16) + ", 0x" + b2.toString(16) + ".\n");
        process.exit(1);
    }
    this._generateDatatypeReaders();
    process.stdout.write("Buffer has ");
    process.stdout.write((hasSubsysOffset ? "" : "no ") + "subsys info.");
    process.stdout.write(" Uses " + (this._useBE ? "big" : "little") + "-endian byte order.");
    process.stdout.write(" Text header:\n" + text + "\n");
    this._state = STATE.DATA_START;
};

BinaryFileReader.prototype._readMatrix = function (ctx) {
    var type,
        length,
        flags,
        ndim,
        name,
        dims = [];
    type = this._readUInt32(ctx),
    length = this._readUInt32(ctx),
    flags = this._readUInt32(ctx);
    console.log("Flags:", type, length, flags);
    console.log("Matrix contains" + ((flags & MATRIX_FLAGS.COMPLEX) ? " complex " : " real ") + "numbers");
    ctx.offset += 4; /* skip reserved 4 bytes */
    type = this._readUInt32(ctx);
    length = this._readUInt32(ctx);
    console.log("Length: " + length);
    ndim = length/4;
    for (var i=0; i < ndim; i++) {
        dims[i] = this._readInt32(ctx);
    }
    console.log("Dimensions:", ndim, dims);
    type = this._readUInt32(ctx);
    length = this._readUInt32(ctx);
    name = Buffer.from(ctx.data.buffer, ctx.offset, length);
    console.log("Name:", name.toString("utf-8"));
    ctx.offset += 8; /* skip over the name */
    type = this._readUInt32(ctx);
    length = this._readUInt32(ctx);
    console.log("Type:", type);
    console.log("Count:", length/8);
    /* FIXME: actually read data */
    ctx.offset += length;
};

BinaryFileReader.prototype._readData = function (ctx) {
    assert(ctx.data);
    assert(typeof ctx.offset === "number");
    assert(ctx.type);
    assert(ctx.length);
    var result;
    switch (ctx.type) {
    case TYPE.COMPRESSED:
        var b = Buffer.from(ctx.data.buffer, ctx.offset, ctx.length),
            raw = zlib.inflateSync(b);
        // create new frame
        this._state = STATE.DATA_START;
        result = this._parseData(_ctx(raw, 0));
        ctx.offset += ctx.length;
        if (ctx.offset === ctx.data.length) {
            return;
        } else {
            setImmediate(() => {
                this._state = STATE.DATA_START;
                this._parseData(ctx);
            });
        }
        break;
    case TYPE.MATRIX:
        result = this._readMatrix(ctx);
        break;
    default:
        throw "Support for type " + ctx.type + " is not yet implemented.";
    }
    return result;
};

BinaryFileReader.prototype._parseData = function (ctx) {
    assert(ctx.data);
    assert(ctx.offset !== undefined);
    switch (this._state) {
    case STATE.DATA_START:
        if (ctx.data.length === ctx.offset) {
            return;
        }
        if (ctx.data.length < 8) {
            break;
        }
        // determine if short format
        // TODO: determine long or short format
        ctx.type = this._readUInt32(ctx);
        if (!_validType(ctx.type)) {
            throw "Invalid type: " + this._meta.type;
        }
        ctx.length = this._readUInt32(ctx);
        if (ctx.data.length - ctx.offset < ctx.length) {
            // if we have not yet read the data completely, wait
            this._state = STATE.DATA_CONTINUE;
            this._ctx = ctx;
            break;
        }
        /* fall through */
    case STATE.DATA_CONTINUE:
        this._readData(ctx);
        if (ctx.offset === ctx.data.length) {
            return;
        } else {
            setImmediate(() => {
                this._state = STATE.DATA_START;
                this._parseData(ctx);
            });
        }
        break;
    default:
        process.stderr.write("Invalid state " + this._state +
            " while reading data.\n");
        process.exit(1);
    }
};

BinaryFileReader.prototype._readFile = function () {
    var stream = fs.createReadStream(this._filename);
    stream.on("close", () => {
        process.stderr.write("Stream closed.\n");
    });
    stream.on("data", (data) => {
        switch (this._state) {
        case STATE.NONE:
            /* must parse header */
            this._readFileHeader(data);
            if (this._state === STATE.ERROR) {
                break;
            }
            /* fall through */
        case STATE.DATA_START:
            this._parseData(_ctx(data, 128));
            break;
        case STATE.DATA_CONTINUE:
            assert(this._ctx);
            var ctx = this._ctx;
            this._ctx.data = Buffer.concat([this._ctx.data, data]);
            if (this._ctx.length && this._ctx.data.length < this._ctx.offset + this._ctx.length) {
                // still not enough
                return;
            }
            this._ctx = undefined;
            this._readData(ctx);
            break;
        default:
            break;
        }
    });
    stream.on("error", (err) => {
        process.stderr.write("Error occured: " + err + "\n");
    });
    stream.on("end", () => {
        process.stderr.write("Stream end.\n");
    });

};

BinaryFileReader.prototype.load = function () {
    this._readFile();
};

function load(filename) {
    var fr = new BinaryFileReader(filename);
    fr.load();

}
load("./ex4weights.mat");

