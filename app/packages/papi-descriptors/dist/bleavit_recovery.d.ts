import { StorageDescriptor, PlainDescriptor, TxDescriptor, RuntimeDescriptor, Enum, ApisFromDef, QueryFromPalletsDef, TxFromPalletsDef, EventsFromPalletsDef, ErrorsFromPalletsDef, ConstFromPalletsDef, ViewFnsFromPalletsDef, SS58String, SizedHex, FixedSizeArray } from "polkadot-api";
import type { I5sesotjlssv2d, Iffmde3ekjedi9, I4mddgoa69c0a2, I5ltmh69i7gt73, I95g6i7ilua7lq, Ieniouoqkq4icf, Phase, Ibgl04rn6nbfm6, I4q39t5hn830vp, I8re9183nrhr3n, I1v7jbnil3tjns, I8jgj1nhcr2dg8, Ifn6q3equiq9qi, Ia3sb0vgvovhtg, Iav8k1edbj86k7, Itom7fk49o0c9, I4i91h98n3cv1b, I4iumukclgj8ej, Iqnbvitf7a7l3, I48i407regf59r, I6r5cbv8ttrb09, Inofn0qqbjtb9, I1q8tnt1cluu5j, I8ds64oj6581v0, Ia7pdug7cdsg8g, Ifnu5trqcrgt5b, I9bin2jc70qt6q, I3qklfjubrljqh, If9iqq7i64mur8, Iag3f1hum3p4c8, I4v5g6i7bmt06o, I4s6jkha20aoh0, I84bhscllvv07n, I78s05f59eoi8b, I35l6p7kq19mr0, TransactionPaymentReleases, Ifble4juuml5ig, Version, Ida3u2t8t1l1js, If9jidduiuq7vv, ConvictionVotingVoteVoting, I6ouflveob4eli, PreimageOldRequestStatus, PreimageRequestStatus, I4pact7n2e9a0i, Ifh9leie5rtseb, I56u24ncejr5kt, I9jd27rnpm8ttv, I775lbh1002e7f, I9p9lq3rej5bhc, Iag146hmjgqfgj, I8uo3fpd3bcc6f, Iepbsvlk3qceij, Icgljjb6j82uhn, I5mpbmq1ooiq9i, I5g2vv0ckl2m8b, Ifup3lg9ro8a0f, Idh2ug6ou4a8og, Iejeo53sea6n4q, I53esa2ms463bk, Ib4jhb8tt3uung, I5qfubnuvrnqn6, I8t3u2dv73ahbd, I7vlvrrl2pnbgk, Ie0rpl5bahldfk, XcmPalletVersionMigrationStage, I7e5oaj2qi4kl1, Ie849h3gncgvok, Iat62vud7hlod2, Ict03eedr8de9s, Ici7ejds60vj52, XcmVersionedLocation, Ia2lhg7l2hilo3, Ifi4da1gej1fri, Ifvgo9568rpmqc, I82jm9g7pufuel, Ic5m5lp1oioo8r, I6cs1itejju2vv, I19osbbvcedbnc, Iapa0pspj5na3t, I5ebvuao287pjg, I71v2rrt182hod, Ia03hjl5um8umc, I1bd4sfsts9lp2, I5m1k92kcp4o6d, Ifkob0fdn3eods, I1ai0vm56bl7eu, I7aij5ls86nd9l, Iafqnechp3omqg, I3hg4c9ge064lf, Iej87d0l2agljs, Ifr88cshss4mco, I3qulnvnc3hn00, Iept8gvj9an6pj, I3ge8l11mhestc, I4qqej82rtmcsa, I8el4qiut1afl1, I2o134i87sa348, I9v1nr5t25p3gu, Ij23g2682mtlh, Ib65ekpdoa117u, Ic9m8l8pkrt2k5, Idjevvptm6gjaq, Id9gm4bteop71s, Ibk7vl3nqtkvjq, I25if6a41d56ra, Icj2nb69liuu24, Icm9f9h6nua3dd, I8hs8cgiei54sv, I43pkljl3a50rq, Ic7ihfq9tebase, Ia78sqv46skudk, I8kuj5ij9r87hi, Ieupfkt3mtrjlc, I5eoome1iv99mc, Ifs8l7uhm2p84a, I205qrookusi3d, Itdvhihql560g, I3fphkj3rkb8d1, Ie358p6da7iusl, I3i3q11ol0f2a8, Iihcv2ffgfdth, I5ss06mick4shb, I3a0nip7t7d0i7, I67b4evvsj5s3g, Ifolljjjlhmesh, I342jcra5dcalu, I6lfe132so20ih, It5jnbkpi46a7, I7emrdrb8oc4do, I4dcivh5duqno8, Iflkot84bd90qk, Ibphrfq348d9fn, I1qevohso20t15, I3dp098duidkfr, I6o17cn2677nom, Ias91rflo6ebo5, Idggr61fqjm503, I8fhaue1ob9s7m, I9mj1qagqpte76, I44n5hoqkdsljm, I7rilbfprtfgq9, Ifip05kcrl65am, I7dp3d6kokg6qm, I806t22dpi77ls, Ib9hqqd0dq5sja, Icqilkshp1mtl, I2rc77s0mqdebl, I2uoo9t5ta92pd, I2og4uv7220vja, I8dfqph7nh6ls, I60nr0tc614tgj, I4p5t2krb1gmvp, I5lf8t4evk0fq7, Ic23t0smeuk6mq, Iacpni5fp46chb, Ie1r5megrresvn, Icrbds76ujpbkg, Ifcik8ed7tl04e, I8jh0enk7f0r9l, Icu5tfrap3ledf, I7jbmorihvfg1b, I7tusvhvaa2qim, Iar9rrgd5eqf9n, I96rqo4i9p11oo, Iilpsjpsgmkpu, Iccj220c6e0rai, I8nofrgats4bb6, I95l2k9b1re95f, In7a38730s6qs, Ibtil0ss5munbk, I9s0ave7t0vnrk, I4fo08joqmcqnm, Ibafpkl9hhno69, Iasb8k6ash5mjn, XcmV5Junctions, I7r7b6bp2g5acg, I7rm113kjbo5gc, I4totqt881mlti, I5pbtpcshc7f67, I35p85j063s0il, I8ofcg5rbj0g2c, I4adgbll7gku4i, I6pjjpfvhvcfru, I9pj91mj79qekl, I39uah9nss64h9, Ik64dknsq7k08, Ib51vk42m1po4n, Idcr6u6361oad9, Ial23jn8hp0aen, Ifpj261e8s63m3, I4ktuaksf5i1gk, I9bqtpv2ii35mp, I9j7pagd6d4bda, I2h9pmio37r7fb, Ibmr18suc9ikh9, I9iq22t0burs89, I5u8olqbbvfnvf, I5utcetro501ir, I7t2thek61ghou, I61tdrsafr1vf3, Ibsk5g3rhm45pu, Icfoe9q8d4vs8f, Ibrfmvjrg4trnb, Iedih7t34maii9, I4e902qbfel1f1, Ie4met0joi8sv0, I1t8vq6a06ohhu, Icvt3pdunbinm7, I9ui3n41balr2q, I89sl7btgl24g2, I3u6g26k9kn96u, If1invp94rsjms, Ie5nc19gtiv5sv, Iald3dgvt1hjkb, Iurrhahet4gno, I5tamv2nk8bj8o, I8apq8e7c7qcpp, Id1e31ij0c35fv, Ibm7u0qulpnrs9, Id9uqtigc0il3v, Iaa2o6cgjdpdn5, Iam6hrl7ptd85l, Ict9ivhr2c5hv0, I8t4vv03357lk9, Ifc6beta7g87k, I666bl2fqjkejo, Icbio0e1f0034b, I8c0vkqjjipnuj, Idnsr2pndm36h0, Ia1pvdcbhuqf8m, I8steo882k7qns, I4pa4q37gj6fua, I5f178ab6b89t3, I4nakhtbsk3c5s, I82nfqfkd48n10, I1jm8m1rh9e20v, I3o5j3bli1pd8e, Iet0dtt3q9k4bk, I5n4sebgkfr760, I2jhl9koipl72b, Ifs1i5fk9cqvr6, I6tndkavufkmbv, Icph8qjashf315, Ieg3fd8p4pkt10, I8kg5ll427kfqq, I467333262q1l9, I7v6q4eo5bpqja, I6ftm1lq7baqj4, I5ua4t7rcge9ca, I1q7iisvnsn9jn, I2cr2dkgo2tr4e, I7vo2kfsore692, I3lj33btcqlb1i, I707m7edh0jft8, I2j5sqe1l974kn, I2eb501t8s6hsq, Ianmuoljk2sk1u, I6232pg7njm7nt, Ib4dcamu44h2f8, Iajkocjedluuc3, Ideaemvoneh309, I3d9o9d7epp66v, I6lqh1vgb4mcja, Ibou4u1engb441, Id6nbvqoqdj4o2, I95iqep3b8snn9, I77l5dsi0gnac7, I8k3rnvpeeh4hv, I5a1mcnnhp9s1k, I3vh014cqgmrfd, I40pqum1mu8qg3, I1r4c2ghbtvjuc, Ia5cotcvi888ln, I21jsa919m88fd, Iegif7m3upfe1k, I9kt8c221c83ln, Ic76kfh5ebqkpl, Icscpmubum33bq, I21d2olof7eb60, Ibgm4rnf22lal1, Ie68np0vpihith, I9bnv6lu0crf1q, Iauhjqifrdklq7, Ie1uso9m8rt5cf, Ifccifqltb5obi, Iadtsfv699cq8b, Ialpmgmhr3gk5r, I4cbvqmqadhrea, I3sdol54kg5jaq, I8fougodaj6di6, I81vt5eq60l4b6, Irupv22iu38vu, I7grtu814479f3, I93s1mcesjtqu3, I1p86ntl6dn03c, I3ri98utbddtsd, I6bpho1qciu1vq, I23de7n843u7sn, I5fe6dsj65bbns, Ideepm5vhbl12g, Idasi83b2hi6kd, I3l1prg489cgso, Ibihfmtr4nutgv, I8b0duu38170aj, I7445bslhc0ic2, Id6e8lk3pfjocj, I449ug3537vfu2, I7r9r972bl7s6h, I45orgf9ulklgj, I7gp5f34oc7pki, I36p2bgnnl36ta, I6qcvfaiubjt05, I7tjbm7l304tu9, I7kcd6p94nv55v, I483r8098di3t5, Ico0ou8pmf1cq5, Ie38ogc3bkfpu, Iasovm2m56clga, I3s764kupqvvc3, Ide781hv7v8ek3, I4n0jfeme2dupj, Iejr8qrqkqh148, Ie00dqaka54s56, I97fq4k68v5pmh, Ifh9jjrch89bli, I17o91bl727r0j, Idbt6597auf3g2, I3nkq26pmovr9u, I1mjueefcqgdaj, Ict5mnga93gs4g, If97gtgn6okleo, I5c87v6pd2sdaf, I5l0jsir5si80s, I86uhg8ivvk3a8, I4ov6e94l79mbg, I3dg8tbt6tcck6, Ibnicuotj4pjfm, I4gj9mv93je4sv, I3f8ncpioik5na, I3qt1hgg4djhgb, Idscf6boak49q1, I3ajpo6bheav6q, Iaoh4afnk8h0fj, Ie239vtc2egj50, I4m6dhgb2ar055, I8m9idjg76ip7q, I3c63j6sh3evqn, Idpghfv397i03j, I1iqmhg9l6j4g5, Ifdhckj0h8qpv2, I4uk5nmqsi401j, I7eloeoebplnvf, Icu0h2un8nbhct, Ifoljaehihf3a6, If5i6c2m5d9b65, I9ihjoku7164ou, I7661jqlhbtghb, I5h8g89cqhubt3, I3gvjatq4m8h18, I8vsdam138s0ak, I68s7org31qt4d, Ielk7f0jb1jt1u, I7n5sdbabu8l7g, I1qpch3k96pn83, I82lmvrrpt0s2n, Ia82mnkmeo2rhc, I206k5fm430ncu, Icbccs0ug47ilf, I855j4i3kr8ko1, Ibt374blbobs7t, Idd7hd99u0ho0n, Iafscmv8tjf0ou, I100l07kaehdlp, I6gnbnvip5vvdi, Icv68aq8841478, Ic262ibdoec56a, Iflcfm9b6nlmdd, Ijrsf4mnp3eka, Id5fm4p8lj5qgi, I8tjvj9uq4b7hi, I4fooe9dun9o0t, I4ici6vhci5d5f, I9ia5eeknmnh40, I9nrdlsbtsjaoc, Iph9c4rn81ub2, Icqe266pmnr25o, I5hoiph0lqphp, I5k7oropl9ofc7, I48vagp1omigob, Ib5tst4ppem1g6, Ibn64edsrg3737, I83r9d02dh47j9, I22bm4d7re21j9, I3jnhifvaeuama, I8n1gia0lo42ok, I6gb0o7lqjfdjq, Idh36v6iegkmpq, I27hnueutmchbe, Iectm2em66uhao, I7q57goff3j72h, Ibe49veu9i9nro, I1rnkmiu7usb82, Ig6jnoe1clkm7, Ibtugueatkkr9s, Ier2cke86dqbr2, Iaeqj2ebnvkjqe, Ih04jp733tqqa, Ievr89968437gm, I229ijht536qdu, I62nte77gksm0f, I9cg2delv92pvq, Ilhp45uime5tp, I4f1hv034jf1dt, I7svrbkiu01iec, I8cbok7qd7ru4t, I7kij8p9kchdjo, I4o5f4rl7pvbsh, Ia3c82eadg79bj, Ienusoeb625ftq, Ibtsa3docbr9el, I3r57ai53kj5og, If17b5mo4d2odo, Imnbuc3d6tdsc, Ibt0qbob7ghhgn, Icovh3ggbhth1s, I8a8c1n38ann55, I2ur0oeqg495j8, I7f2f3co93gefl, I1bhd210c3phjj, Iep27ialq4a7o7, Iasu5jvoqr43mv, I5ank11b0br54o, I5qolde99acmd1, I8gtde5abn1g9a, If1co0pilmi7oq, Iae74gjak1qibn, I3escdojpj0551, I7442cggth99kp, I5rtkmhm2dng4u, I137t1cld92pod, I1rvj4ubaplho0, Ia3uu7lqcc1q1i, I7crucfnonitkn, I7tmrp94r9sq4n, Ibslgga81p36aa, I61d51nv4cou88, If8u5kl4h8070m, Ibmuil6p3vl83l, I7lul91g50ae87, Icl7nl1rfeog3i, Iasr6pj6shs0fl, I2uqmls7kcdnii, Idg69klialbkb8, I7r6b7145022pp, I30pg328m00nr3, Icmrn7bogp28cs, I7m9b5plj4h5ot, I9onhk772nfs4f, I3l6bnksrmt56r, Idh09k0l2pmdcg, I7uoiphbm0tj4r, I512p1n7qt24l8, I6s1nbislhk619, I3gghqnh2mj0is, I6iv852roh6t3h, I9oc2o6itbiopq, I39t01nnod9109, I6v8sm60vvkmk7, I1qmtmbe5so8r3, Ih99m6ehpcar7, Idgorhsbgdq2ap, I9ubb2kqevnu6t, I2hq50pu2kdjpo, I9acqruh7322g2, I8i1bk7kj5k5ed, Ie5qta40r3ho5l, Ibfd56bn4a7kfk, Ifcslavva7skj1, Icolandhn4qpus, I333ps8sjf4lhr, Iah5vhnso7uqce, I2lct6m7k5r2et, I9cf6so4vur6mg, Isntabb3i2t9f, I40af445fa06rh, Iapmmsuq8j9rcn, I80dirtbv2ognl, I6qrovovkeah6g, I5v7n6l8j8vd1f, I2kpgolvhr6ftt, I20e9ph536u7ti, Id2312c48f17dd, I7a6s4h48lmk1t, I2fkgb649u353b, I3a053sft19jid, Idj8pac8q2ngco, I2sg7pchi235m2, Ibg0qukn7q6t5u, I93sj8arfs7e7f, I3qf57dn94jogo, I7jnda8be156fb, I27lb9t574io60, Ic7t67gl6oo8ed, Ifaori90nvndr0, Ie2rqjbtm23ftk, I7oiv62sj2f3r3, I4oohlti0ugomv, Icj2jtt996rgo7, I55162di4jv6rk, Ib8h08jrok1svd, I4m6m36nu8gsqu, Ie1dicjiiaa5q8, I239j3gnc1jsps, I15atr7h39m6es, I5052qcfs60vjm, If8en01tuc3bij, I5euu4q9kmp9c3, Ictvl5d049lms3, I94jeskiehjtf1, I36oknt2f8tl4g, I288nkd84a7m9u, Ifc75td2ivg90e, I7i7gk545r3sv3, I97i24r5tc4i6u, I5tek56pm6maiv, I60fhenaqhrkjj, I6o7guvg1i99i2, I5l6c62egasn2e, I3qv7v9gggggd4, I7dq91mkderm2o, Ie2mt3ul73mn1d, I50qqth3sk471t, I5em265vo8vck5, Ibp2vba0704net, Idts26aojvm4gr, I141piq296rc2n, I3a4qht3l7q9rt, Iasl7n2tkle090, I178uj1s35amp3, Iai5mccr300imn, I1uen92pl1lhqu, Id6ktlm8uq63g6, I4f2hva90hak3m, I823eg09r939h3, Ibcj87mgvuqbc8, I5d87nqeditd0c, Ib4lvahglmvoj4, Ib5tkqghj5b2lj, I6d3ckosptflrl, I3if4k84v5n0f6, I5k37qbr3s9v15, I5eol3g6qqti18, I1qrnckffb9nrm, I1e0oh3bn9igat, I70l5rhpgblmim, Id94b4a7r8bjeq, Ic4vbg4dnnpegu, I7nl4maqn6m365, I6bq7cmd37a5ik, I9i68vrjhvjnp1, Icu71ht824icnq, I3fr1hdlq8g81s, I1c5ncj72v7k27, Idhhlivifn563e, I3o9sh4pms1jcb, Iij42ed7fk1sg, I8vg1ab5ssn90l, Ifai7amejetiv, I5el2hvlofnvv5, Ibqi69m3s38lo0, I6ctvd5gvtboll, Ierkp6g0vn9ojj, I1srp17os6n92p, I1hd2l2dfhk11i, Idrd3fp3ciqt4f, I15300qnq5mpkt, I689heiuu575e6, I6v9f8qobgk41i, Ie4auh3nmut3h7, I93vothlkfb80t, I34ssr4fhp2kik, Icctupj3ftl0ch, I86dulb0e6aqlq, Iffhjj19aangi6, Ib6pl1520ec2jq, I75eb7jq67cg5l, I5r8t4iaend96p, Iaqet9jc3ihboe, Ic952bubvq4k7d, I2v50gu3s1aqk6, Iabpgqcjikia83, I4gil44d08grh, I7u915mvkdsb08, I7g3jnj59cuc3k, I3nir9l71btsd5, Ib4c4hbfg3ril4, I6bep0s8nf1jn4, Idbhri2uj6av22, Ietccudq8ucajb, I3fvgo362krtrr, Ifi0c8r8eomqru, I6tacm14gh0jtv, Ibe056naqv5jeg, Idq3lmpdqfuf91, I8s95j32t1rrnr, If9jrft6hbnnq, I4ujid8kn88isk, Idu551939jhadj, I9fgo4t9o7trj7, I607t5e3e5mnk5, Ie8c3gf89pirvk, Idt3pdmk8m17j6, I8fksma6odit5g, I996aiv3qoehvi, I4fj3mptf3jr0q, Ibh9utbkad113n, I4s6vifaf8k998, Id5433fsuakfsh, If7uv525tdvv7a, I2an1fs2eiebjp, TransactionValidityTransactionSource, I9ask1o4tfvcvs, I4ph3d1eepnmr1, Icerf8h8pdu8ss, I15h4jnb8b841p, I6spmpef2c7svf, Iei2mvq0mjvt81, I3hev30cis3ndu, Ic1d4u2opv3fst, Ie9sr1iqcg3cgm, I1mqgk2tmnn9i2, I6lr8sctk0bi4e, Idmmv2hj79l5es } from "./common-types";
type AnonymousEnum<T extends {}> = T & { __anonymous: true };
type MyTuple<T> = [T, ...T[]];
type SeparateUndefined<T> = undefined extends T ? undefined | Exclude<T, undefined> : T;
type Anonymize<T> = SeparateUndefined<T extends string | number | bigint | boolean | void | undefined | null | symbol | Uint8Array | Enum<any> ? T : T extends AnonymousEnum<infer V> ? Enum<V> : T extends MyTuple<any> ? { [K in keyof T]: T[K] } : T extends [] ? [] : T extends FixedSizeArray<infer L, infer T> ? (number extends L ? Array<T> : FixedSizeArray<L, T>) : { [K in keyof T & string]: T[K] }>;
type IStorage = {
  System: {
    /**
     * The full account information for a particular account ID.
     */
    Account: StorageDescriptor<[Key: SS58String], Anonymize<I5sesotjlssv2d>, false, never>;
    /**
     * Total extrinsics count for the current block.
     */
    ExtrinsicCount: StorageDescriptor<[], number, true, never>;
    /**
     * Whether all inherents have been applied.
     */
    InherentsApplied: StorageDescriptor<[], boolean, false, never>;
    /**
     * The current weight for the block.
     */
    BlockWeight: StorageDescriptor<[], Anonymize<Iffmde3ekjedi9>, false, never>;
    /**
     * Total size (in bytes) of the current block.
     *
     * Tracks the size of the header and all extrinsics.
     */
    BlockSize: StorageDescriptor<[], number, true, never>;
    /**
     * Map of block numbers to block hashes.
     */
    BlockHash: StorageDescriptor<[Key: number], SizedHex<32>, false, never>;
    /**
     * Extrinsics data for the current block (maps an extrinsic's index to its data).
     */
    ExtrinsicData: StorageDescriptor<[Key: number], Uint8Array, false, never>;
    /**
     * The current block number being processed. Set by `execute_block`.
     */
    Number: StorageDescriptor<[], number, false, never>;
    /**
     * Hash of the previous block.
     */
    ParentHash: StorageDescriptor<[], SizedHex<32>, false, never>;
    /**
     * Digest of the current block, also part of the block header.
     */
    Digest: StorageDescriptor<[], Anonymize<I4mddgoa69c0a2>, false, never>;
    /**
     * Events deposited for the current block.
     *
     * NOTE: The item is unbound and should therefore never be read on chain.
     * It could otherwise inflate the PoV size of a block.
     *
     * Events have a large in-memory size. Box the events to not go out-of-memory
     * just in case someone still reads them from within the runtime.
     */
    Events: StorageDescriptor<[], Anonymize<I5ltmh69i7gt73>, false, never>;
    /**
     * The number of events in the `Events<T>` list.
     */
    EventCount: StorageDescriptor<[], number, false, never>;
    /**
     * Mapping between a topic (represented by T::Hash) and a vector of indexes
     * of events in the `<Events<T>>` list.
     *
     * All topic vectors have deterministic storage locations depending on the topic. This
     * allows light-clients to leverage the changes trie storage tracking mechanism and
     * in case of changes fetch the list of events of interest.
     *
     * The value has the type `(BlockNumberFor<T>, EventIndex)` because if we used only just
     * the `EventIndex` then in case if the topic has the same contents on the next block
     * no notification will be triggered thus the event might be lost.
     */
    EventTopics: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I95g6i7ilua7lq>, false, never>;
    /**
     * Stores the `spec_version` and `spec_name` of when the last runtime upgrade happened.
     */
    LastRuntimeUpgrade: StorageDescriptor<[], Anonymize<Ieniouoqkq4icf>, true, never>;
    /**
     * Number of blocks till the pending code upgrade is applied.
     */
    BlocksTillUpgrade: StorageDescriptor<[], number, true, never>;
    /**
     * True if we have upgraded so that `type RefCount` is `u32`. False (default) if not.
     */
    UpgradedToU32RefCount: StorageDescriptor<[], boolean, false, never>;
    /**
     * True if we have upgraded so that AccountInfo contains three types of `RefCount`. False
     * (default) if not.
     */
    UpgradedToTripleRefCount: StorageDescriptor<[], boolean, false, never>;
    /**
     * The execution phase of the block.
     */
    ExecutionPhase: StorageDescriptor<[], Phase, true, never>;
    /**
     * `Some` if a code upgrade has been authorized.
     */
    AuthorizedUpgrade: StorageDescriptor<[], Anonymize<Ibgl04rn6nbfm6>, true, never>;
    /**
     * The weight reclaimed for the extrinsic.
     *
     * This information is available until the end of the extrinsic execution.
     * More precisely this information is removed in `note_applied_extrinsic`.
     *
     * Logic doing some post dispatch weight reduction must update this storage to avoid duplicate
     * reduction.
     */
    ExtrinsicWeightReclaimed: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, false, never>;
  };
  Timestamp: {
    /**
     * The current time for the current block.
     */
    Now: StorageDescriptor<[], bigint, false, never>;
    /**
     * Whether the timestamp has been updated in this block.
     *
     * This value is updated to `true` upon successful submission of a timestamp by a node.
     * It is then checked at the end of each block execution in the `on_finalize` hook.
     */
    DidUpdate: StorageDescriptor<[], boolean, false, never>;
  };
  ParachainSystem: {
    /**
     * The current block weight mode.
     *
     * This is used to determine what is the maximum allowed block weight, for more information see
     * [`block_weight`].
     *
     * Killed in [`Self::on_initialize`] and set by the [`block_weight`] logic.
     */
    BlockWeightMode: StorageDescriptor<[], Anonymize<I8re9183nrhr3n>, true, never>;
    /**
     * The core count available to the parachain in the previous block.
     *
     * This is mainly used for offchain functionality to calculate the correct target block weight.
     */
    PreviousCoreCount: StorageDescriptor<[], number, true, never>;
    /**
     * Latest included block descendants the runtime accepted. In other words, these are
     * ancestors of the currently executing block which have not been included in the observed
     * relay-chain state.
     *
     * The segment length is limited by the capacity returned from the [`ConsensusHook`] configured
     * in the pallet.
     */
    UnincludedSegment: StorageDescriptor<[], Anonymize<I1v7jbnil3tjns>, false, never>;
    /**
     * Storage field that keeps track of bandwidth used by the unincluded segment along with the
     * latest HRMP watermark. Used for limiting the acceptance of new blocks with
     * respect to relay chain constraints.
     */
    AggregatedUnincludedSegment: StorageDescriptor<[], Anonymize<I8jgj1nhcr2dg8>, true, never>;
    /**
     * In case of a scheduled upgrade, this storage field contains the validation code to be
     * applied.
     *
     * As soon as the relay chain gives us the go-ahead signal, we will overwrite the
     * [`:pending_code`][sp_core::storage::well_known_keys::PENDING_CODE] which will result the
     * next block to be processed with the new validation code. This concludes the upgrade process.
     */
    PendingValidationCode: StorageDescriptor<[], Uint8Array, false, never>;
    /**
     * Validation code that is set by the parachain and is to be communicated to collator and
     * consequently the relay-chain.
     *
     * This will be cleared in `on_initialize` of each new block if no other pallet already set
     * the value.
     */
    NewValidationCode: StorageDescriptor<[], Uint8Array, true, never>;
    /**
     * The [`PersistedValidationData`] set for this block.
     *
     * This value is expected to be set only once by the [`Pallet::set_validation_data`] inherent.
     */
    ValidationData: StorageDescriptor<[], Anonymize<Ifn6q3equiq9qi>, true, never>;
    /**
     * Were the validation data set to notify the relay chain?
     */
    DidSetValidationCode: StorageDescriptor<[], boolean, false, never>;
    /**
     * The relay chain block number associated with the last parachain block.
     *
     * This is updated in `on_finalize`.
     */
    LastRelayChainBlockNumber: StorageDescriptor<[], number, false, never>;
    /**
     * An option which indicates if the relay-chain restricts signalling a validation code upgrade.
     * In other words, if this is `Some` and [`NewValidationCode`] is `Some` then the produced
     * candidate will be invalid.
     *
     * This storage item is a mirror of the corresponding value for the current parachain from the
     * relay-chain. This value is ephemeral which means it doesn't hit the storage. This value is
     * set after the inherent.
     */
    UpgradeRestrictionSignal: StorageDescriptor<[], Anonymize<Ia3sb0vgvovhtg>, false, never>;
    /**
     * Optional upgrade go-ahead signal from the relay-chain.
     *
     * This storage item is a mirror of the corresponding value for the current parachain from the
     * relay-chain. This value is ephemeral which means it doesn't hit the storage. This value is
     * set after the inherent.
     */
    UpgradeGoAhead: StorageDescriptor<[], Anonymize<Iav8k1edbj86k7>, false, never>;
    /**
     * The state proof for the last relay parent block.
     *
     * This field is meant to be updated each block with the validation data inherent. Therefore,
     * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
     *
     * This data is also absent from the genesis.
     */
    RelayStateProof: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, true, never>;
    /**
     * The snapshot of some state related to messaging relevant to the current parachain as per
     * the relay parent.
     *
     * This field is meant to be updated each block with the validation data inherent. Therefore,
     * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
     *
     * This data is also absent from the genesis.
     */
    RelevantMessagingState: StorageDescriptor<[], Anonymize<I4i91h98n3cv1b>, true, never>;
    /**
     * The parachain host configuration that was obtained from the relay parent.
     *
     * This field is meant to be updated each block with the validation data inherent. Therefore,
     * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
     *
     * This data is also absent from the genesis.
     */
    HostConfiguration: StorageDescriptor<[], Anonymize<I4iumukclgj8ej>, true, never>;
    /**
     * The last downward message queue chain head we have observed.
     *
     * This value is loaded before and saved after processing inbound downward messages carried
     * by the system inherent.
     */
    LastDmqMqcHead: StorageDescriptor<[], SizedHex<32>, false, never>;
    /**
     * The message queue chain heads we have observed per each channel incoming channel.
     *
     * This value is loaded before and saved after processing inbound downward messages carried
     * by the system inherent.
     */
    LastHrmpMqcHeads: StorageDescriptor<[], Anonymize<Iqnbvitf7a7l3>, false, never>;
    /**
     * Number of downward messages processed in a block.
     *
     * This will be cleared in `on_initialize` of each new block.
     */
    ProcessedDownwardMessages: StorageDescriptor<[], number, false, never>;
    /**
     * The last processed downward message.
     *
     * We need to keep track of this to filter the messages that have been already processed.
     */
    LastProcessedDownwardMessage: StorageDescriptor<[], Anonymize<I48i407regf59r>, true, never>;
    /**
     * HRMP watermark that was set in a block.
     */
    HrmpWatermark: StorageDescriptor<[], number, false, never>;
    /**
     * The last processed HRMP message.
     *
     * We need to keep track of this to filter the messages that have been already processed.
     */
    LastProcessedHrmpMessage: StorageDescriptor<[], Anonymize<I48i407regf59r>, true, never>;
    /**
     * HRMP messages that were sent in a block.
     *
     * This will be cleared in `on_initialize` of each new block.
     */
    HrmpOutboundMessages: StorageDescriptor<[], Anonymize<I6r5cbv8ttrb09>, false, never>;
    /**
     * Upward messages that were sent in a block.
     *
     * This will be cleared in `on_initialize` for each new block.
     */
    UpwardMessages: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
    /**
     * Upward messages that are still pending and not yet sent to the relay chain.
     */
    PendingUpwardMessages: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
    /**
     * Upward signals that are still pending and not yet sent to the relay chain.
     *
     * This will be cleared in `on_finalize` for each block.
     */
    PendingUpwardSignals: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
    /**
     * The approved peer id to be sent as a UMP signal on the last block of the PoV.
     */
    PendingApprovedPeer: StorageDescriptor<[], Uint8Array, true, never>;
    /**
     * The factor to multiply the base delivery fee by for UMP.
     */
    UpwardDeliveryFeeFactor: StorageDescriptor<[], bigint, false, never>;
    /**
     * The number of HRMP messages we observed in `on_initialize` and thus used that number for
     * announcing the weight of `on_initialize` and `on_finalize`.
     */
    AnnouncedHrmpMessagesPerCandidate: StorageDescriptor<[], number, false, never>;
    /**
     * The weight we reserve at the beginning of the block for processing XCMP messages. This
     * overrides the amount set in the Config trait.
     */
    ReservedXcmpWeightOverride: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, true, never>;
    /**
     * The weight we reserve at the beginning of the block for processing DMP messages. This
     * overrides the amount set in the Config trait.
     */
    ReservedDmpWeightOverride: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, true, never>;
    /**
     * A custom head data that should be returned as result of `validate_block`.
     *
     * See `Pallet::set_custom_validation_head_data` for more information.
     */
    CustomValidationHeadData: StorageDescriptor<[], Uint8Array, true, never>;
    /**
     * Tracks cumulative `UMP` and `HRMP` messages sent across blocks in the current `PoV`.
     *
     * Across different candidates/PoVs the budgets are tracked by [`AggregatedUnincludedSegment`].
     */
    PoVMessagesTracker: StorageDescriptor<[], Anonymize<Inofn0qqbjtb9>, true, never>;
  };
  ParachainInfo: {
    /**
        
         */
    ParachainId: StorageDescriptor<[], number, false, never>;
  };
  Balances: {
    /**
     * The total units issued in the system.
     */
    TotalIssuance: StorageDescriptor<[], bigint, false, never>;
    /**
     * The total units of outstanding deactivated balance in the system.
     */
    InactiveIssuance: StorageDescriptor<[], bigint, false, never>;
    /**
     * The Balances pallet example of storing the balance of an account.
     *
     * # Example
     *
     * ```nocompile
     * impl pallet_balances::Config for Runtime {
     * type AccountStore = StorageMapShim<Self::Account<Runtime>, frame_system::Provider<Runtime>, AccountId, Self::AccountData<Balance>>
     * }
     * ```
     *
     * You can also store the balance of an account in the `System` pallet.
     *
     * # Example
     *
     * ```nocompile
     * impl pallet_balances::Config for Runtime {
     * type AccountStore = System
     * }
     * ```
     *
     * But this comes with tradeoffs, storing account balances in the system pallet stores
     * `frame_system` data alongside the account data contrary to storing account balances in the
     * `Balances` pallet, which uses a `StorageMap` to store balances data only.
     * NOTE: This is only used in the case that this pallet is used to store balances.
     */
    Account: StorageDescriptor<[Key: SS58String], Anonymize<I1q8tnt1cluu5j>, false, never>;
    /**
     * Any liquidity locks on some account balances.
     * NOTE: Should only be accessed when setting, changing and freeing a lock.
     *
     * Use of locks is deprecated in favour of freezes. See `https://github.com/paritytech/substrate/pull/12951/`
     */
    Locks: StorageDescriptor<[Key: SS58String], Anonymize<I8ds64oj6581v0>, false, never>;
    /**
     * Named reserves on some account balances.
     *
     * Use of reserves is deprecated in favour of holds. See `https://github.com/paritytech/substrate/pull/12951/`
     */
    Reserves: StorageDescriptor<[Key: SS58String], Anonymize<Ia7pdug7cdsg8g>, false, never>;
    /**
     * Holds on account balances.
     */
    Holds: StorageDescriptor<[Key: SS58String], Anonymize<Ifnu5trqcrgt5b>, false, never>;
    /**
     * Freeze locks on account balances.
     */
    Freezes: StorageDescriptor<[Key: SS58String], Anonymize<I9bin2jc70qt6q>, false, never>;
  };
  ForeignAssets: {
    /**
     * Details of an asset.
     */
    Asset: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<I3qklfjubrljqh>, true, never>;
    /**
     * The holdings of a specific account for a specific asset.
     */
    Account: StorageDescriptor<Anonymize<I4v5g6i7bmt06o>, Anonymize<Iag3f1hum3p4c8>, true, never>;
    /**
     * Approved balance transfers. First balance is the amount approved for transfer. Second
     * is the amount of `T::Currency` reserved for storing this.
     * First key is the asset ID, second key is the owner and third key is the delegate.
     */
    Approvals: StorageDescriptor<Anonymize<I84bhscllvv07n>, Anonymize<I4s6jkha20aoh0>, true, never>;
    /**
     * Metadata of an asset.
     */
    Metadata: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<I78s05f59eoi8b>, false, never>;
    /**
     * Maps an asset to a list of its configured reserve information.
     */
    Reserves: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<I35l6p7kq19mr0>, false, never>;
    /**
     * The asset ID enforced for the next asset creation, if any present. Otherwise, this storage
     * item has no effect.
     *
     * This can be useful for setting up constraints for IDs of the new assets. For example, by
     * providing an initial [`NextAssetId`] and using the [`crate::AutoIncAssetId`] callback, an
     * auto-increment model can be applied to all new asset IDs.
     *
     * The initial next asset ID can be set using the [`GenesisConfig`] or the
     * [SetNextAssetId](`migration::next_asset_id::SetNextAssetId`) migration.
     */
    NextAssetId: StorageDescriptor<[], Anonymize<If9iqq7i64mur8>, true, never>;
  };
  TransactionPayment: {
    /**
        
         */
    NextFeeMultiplier: StorageDescriptor<[], bigint, false, never>;
    /**
        
         */
    StorageVersion: StorageDescriptor<[], TransactionPaymentReleases, false, never>;
    /**
     * The `OnChargeTransaction` stores the withdrawn tx fee here.
     *
     * Use `withdraw_txfee` and `remaining_txfee` to access from outside the crate.
     */
    TxPaymentCredit: StorageDescriptor<[], bigint, true, never>;
  };
  Vesting: {
    /**
     * Information regarding the vesting of a given account.
     */
    Vesting: StorageDescriptor<[Key: SS58String], Anonymize<Ifble4juuml5ig>, true, never>;
    /**
     * Storage version of the pallet.
     *
     * New networks start with latest version, as determined by the genesis build.
     */
    StorageVersion: StorageDescriptor<[], Version, false, never>;
  };
  Referenda: {
    /**
     * The next free referendum index, aka the number of referenda started so far.
     */
    ReferendumCount: StorageDescriptor<[], number, false, never>;
    /**
     * Information concerning any given referendum.
     */
    ReferendumInfoFor: StorageDescriptor<[Key: number], Anonymize<Ida3u2t8t1l1js>, true, never>;
    /**
     * The sorted list of referenda ready to be decided but not yet being decided, ordered by
     * conviction-weighted approvals.
     *
     * This should be empty if `DecidingCount` is less than `TrackInfo::max_deciding`.
     */
    TrackQueue: StorageDescriptor<[Key: number], Anonymize<If9jidduiuq7vv>, false, never>;
    /**
     * The number of referenda being decided currently.
     */
    DecidingCount: StorageDescriptor<[Key: number], number, false, never>;
    /**
     * The metadata is a general information concerning the referendum.
     * The `Hash` refers to the preimage of the `Preimages` provider which can be a JSON
     * dump or IPFS hash of a JSON file.
     *
     * Consider a garbage collection for a metadata of finished referendums to `unrequest` (remove)
     * large preimages.
     */
    MetadataOf: StorageDescriptor<[Key: number], SizedHex<32>, true, never>;
  };
  ConvictionVoting: {
    /**
     * All voting for a particular voter in a particular voting class. We store the balance for the
     * number of votes that we have recorded.
     */
    VotingFor: StorageDescriptor<Anonymize<I6ouflveob4eli>, ConvictionVotingVoteVoting, false, never>;
    /**
     * The voting classes which have a non-zero lock requirement and the lock amounts which they
     * require. The actual amount locked on behalf of this pallet should always be the maximum of
     * this list.
     */
    ClassLocksFor: StorageDescriptor<[Key: SS58String], Anonymize<If9jidduiuq7vv>, false, never>;
  };
  Preimage: {
    /**
     * The request status of a given hash.
     */
    StatusFor: StorageDescriptor<[Key: SizedHex<32>], PreimageOldRequestStatus, true, never>;
    /**
     * The request status of a given hash.
     */
    RequestStatusFor: StorageDescriptor<[Key: SizedHex<32>], PreimageRequestStatus, true, never>;
    /**
        
         */
    PreimageFor: StorageDescriptor<[Key: Anonymize<I4pact7n2e9a0i>], Uint8Array, true, never>;
  };
  Scheduler: {
    /**
     * Block number at which the agenda began incomplete execution.
     */
    IncompleteSince: StorageDescriptor<[], number, true, never>;
    /**
     * Items to be executed, indexed by the block number that they should be executed on.
     */
    Agenda: StorageDescriptor<[Key: number], Anonymize<Ifh9leie5rtseb>, false, never>;
    /**
     * Retry configurations for items to be executed, indexed by task address.
     */
    Retries: StorageDescriptor<[Key: Anonymize<I9jd27rnpm8ttv>], Anonymize<I56u24ncejr5kt>, true, never>;
    /**
     * Lookup from a name to the block number and index of the task.
     *
     * For v3 -> v4 the previously unbounded identities are Blake2-256 hashed to form the v4
     * identities.
     */
    Lookup: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I9jd27rnpm8ttv>, true, never>;
  };
  Proxy: {
    /**
     * The set of account proxies. Maps the account which has delegated to the accounts
     * which are being delegated to, together with the amount held on deposit.
     */
    Proxies: StorageDescriptor<[Key: SS58String], Anonymize<I775lbh1002e7f>, false, never>;
    /**
     * The announcements made by the proxy (key).
     */
    Announcements: StorageDescriptor<[Key: SS58String], Anonymize<I9p9lq3rej5bhc>, false, never>;
  };
  Multisig: {
    /**
     * The set of open multisig operations.
     */
    Multisigs: StorageDescriptor<Anonymize<I8uo3fpd3bcc6f>, Anonymize<Iag146hmjgqfgj>, true, never>;
  };
  Migrations: {
    /**
     * The currently active migration to run and its cursor.
     *
     * `None` indicates that no migration is running.
     */
    Cursor: StorageDescriptor<[], Anonymize<Iepbsvlk3qceij>, true, never>;
    /**
     * Set of all successfully executed migrations.
     *
     * This is used as blacklist, to not re-execute migrations that have not been removed from the
     * codebase yet. Governance can regularly clear this out via `clear_historic`.
     */
    Historic: StorageDescriptor<[Key: Uint8Array], null, true, never>;
  };
  Sudo: {
    /**
     * The `AccountId` of the sudo key.
     */
    Key: StorageDescriptor<[], SS58String, true, never>;
  };
  XcmpQueue: {
    /**
     * The suspended inbound XCMP channels. All others are not suspended.
     *
     * This is a `StorageValue` instead of a `StorageMap` since we expect multiple reads per block
     * to different keys with a one byte payload. The access to `BoundedBTreeSet` will be cached
     * within the block and therefore only included once in the proof size.
     *
     * NOTE: The PoV benchmarking cannot know this and will over-estimate, but the actual proof
     * will be smaller.
     */
    InboundXcmpSuspended: StorageDescriptor<[], Anonymize<Icgljjb6j82uhn>, false, never>;
    /**
     * The non-empty XCMP channels in order of becoming non-empty, and the index of the first
     * and last outbound message. If the two indices are equal, then it indicates an empty
     * queue and there must be a non-`Ok` `OutboundStatus`. We assume queues grow no greater
     * than 65535 items. Queue indices for normal messages begin at one; zero is reserved in
     * case of the need to send a high-priority signal message this block.
     * The bool is true if there is a signal message waiting to be sent.
     */
    OutboundXcmpStatus: StorageDescriptor<[], Anonymize<I5mpbmq1ooiq9i>, false, never>;
    /**
     * The messages outbound in a given XCMP channel.
     */
    OutboundXcmpMessages: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Uint8Array, false, never>;
    /**
     * Any signal messages waiting to be sent.
     */
    SignalMessages: StorageDescriptor<[Key: number], Uint8Array, false, never>;
    /**
     * The configuration which controls the dynamics of the outbound queue.
     */
    QueueConfig: StorageDescriptor<[], Anonymize<Ifup3lg9ro8a0f>, false, never>;
    /**
     * Whether or not the XCMP queue is suspended from executing incoming XCMs or not.
     */
    QueueSuspended: StorageDescriptor<[], boolean, false, never>;
    /**
     * The factor to multiply the base delivery fee by.
     */
    DeliveryFeeFactor: StorageDescriptor<[Key: number], bigint, false, never>;
  };
  MessageQueue: {
    /**
     * The index of the first and last (non-empty) pages.
     */
    BookStateFor: StorageDescriptor<[Key: Anonymize<Iejeo53sea6n4q>], Anonymize<Idh2ug6ou4a8og>, false, never>;
    /**
     * The origin at which we should begin servicing.
     */
    ServiceHead: StorageDescriptor<[], Anonymize<Iejeo53sea6n4q>, true, never>;
    /**
     * The map of page indices to pages.
     */
    Pages: StorageDescriptor<Anonymize<Ib4jhb8tt3uung>, Anonymize<I53esa2ms463bk>, true, never>;
  };
  PolkadotXcm: {
    /**
     * The latest available query index.
     */
    QueryCounter: StorageDescriptor<[], bigint, false, never>;
    /**
     * The ongoing queries.
     */
    Queries: StorageDescriptor<[Key: bigint], Anonymize<I5qfubnuvrnqn6>, true, never>;
    /**
     * The existing asset traps.
     *
     * Key is the blake2 256 hash of (origin, versioned `Assets`) pair. Value is the number of
     * times this pair has been trapped (usually just 1 if it exists at all).
     */
    AssetTraps: StorageDescriptor<[Key: SizedHex<32>], number, false, never>;
    /**
     * Default version to encode XCM when latest version of destination is unknown. If `None`,
     * then the destinations whose XCM version is unknown are considered unreachable.
     */
    SafeXcmVersion: StorageDescriptor<[], number, true, never>;
    /**
     * The Latest versions that we know various locations support.
     */
    SupportedVersion: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, number, true, never>;
    /**
     * All locations that we have requested version notifications from.
     */
    VersionNotifiers: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, bigint, true, never>;
    /**
     * The target locations that are subscribed to our version changes, as well as the most recent
     * of our versions we informed them of.
     */
    VersionNotifyTargets: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, Anonymize<I7vlvrrl2pnbgk>, true, never>;
    /**
     * Destinations whose latest XCM version we would like to know. Duplicates not allowed, and
     * the `u32` counter is the number of times that a send to the destination has been attempted,
     * which is used as a prioritization.
     */
    VersionDiscoveryQueue: StorageDescriptor<[], Anonymize<Ie0rpl5bahldfk>, false, never>;
    /**
     * The current migration's stage, if any.
     */
    CurrentMigration: StorageDescriptor<[], XcmPalletVersionMigrationStage, true, never>;
    /**
     * Fungible assets which we know are locked on a remote chain.
     */
    RemoteLockedFungibles: StorageDescriptor<Anonymize<Ie849h3gncgvok>, Anonymize<I7e5oaj2qi4kl1>, true, never>;
    /**
     * Fungible assets which we know are locked on this chain.
     */
    LockedFungibles: StorageDescriptor<[Key: SS58String], Anonymize<Iat62vud7hlod2>, true, never>;
    /**
     * Global suspension state of the XCM executor.
     */
    XcmExecutionSuspended: StorageDescriptor<[], boolean, false, never>;
    /**
     * Whether or not incoming XCMs (both executed locally and received) should be recorded.
     * Only one XCM program will be recorded at a time.
     * This is meant to be used in runtime APIs, and it's advised it stays false
     * for all other use cases, so as to not degrade regular performance.
     *
     * Only relevant if this pallet is being used as the [`xcm_executor::traits::RecordXcm`]
     * implementation in the XCM executor configuration.
     */
    ShouldRecordXcm: StorageDescriptor<[], boolean, false, never>;
    /**
     * If [`ShouldRecordXcm`] is set to true, then the last XCM program executed locally
     * will be stored here.
     * Runtime APIs can fetch the XCM that was executed by accessing this value.
     *
     * Only relevant if this pallet is being used as the [`xcm_executor::traits::RecordXcm`]
     * implementation in the XCM executor configuration.
     */
    RecordedXcm: StorageDescriptor<[], Anonymize<Ict03eedr8de9s>, true, never>;
    /**
     * Map of authorized aliasers of local origins. Each local location can authorize a list of
     * other locations to alias into it. Each aliaser is only valid until its inner `expiry`
     * block number.
     */
    AuthorizedAliases: StorageDescriptor<[Key: XcmVersionedLocation], Anonymize<Ici7ejds60vj52>, true, never>;
  };
  Authorship: {
    /**
     * Author of current block.
     */
    Author: StorageDescriptor<[], SS58String, true, never>;
  };
  CollatorSelection: {
    /**
     * The invulnerable, permissioned collators. This list must be sorted.
     */
    Invulnerables: StorageDescriptor<[], Anonymize<Ia2lhg7l2hilo3>, false, never>;
    /**
     * The (community, limited) collation candidates. `Candidates` and `Invulnerables` should be
     * mutually exclusive.
     *
     * This list is sorted in ascending order by deposit and when the deposits are equal, the least
     * recently updated is considered greater.
     */
    CandidateList: StorageDescriptor<[], Anonymize<Ifi4da1gej1fri>, false, never>;
    /**
     * Last block authored by collator.
     */
    LastAuthoredBlock: StorageDescriptor<[Key: SS58String], number, false, never>;
    /**
     * Desired number of candidates.
     *
     * This should ideally always be less than [`Config::MaxCandidates`] for weights to be correct.
     */
    DesiredCandidates: StorageDescriptor<[], number, false, never>;
    /**
     * Fixed amount to deposit to become a collator.
     *
     * When a collator calls `leave_intent` they immediately receive the deposit back.
     */
    CandidacyBond: StorageDescriptor<[], bigint, false, never>;
  };
  Session: {
    /**
     * The current set of validators.
     */
    Validators: StorageDescriptor<[], Anonymize<Ia2lhg7l2hilo3>, false, never>;
    /**
     * Current index of the session.
     */
    CurrentIndex: StorageDescriptor<[], number, false, never>;
    /**
     * True if the underlying economic identities or weighting behind the validators
     * has changed in the queued validator set.
     */
    QueuedChanged: StorageDescriptor<[], boolean, false, never>;
    /**
     * The queued keys for the next session. When the next session begins, these keys
     * will be used to determine the validator's session keys.
     */
    QueuedKeys: StorageDescriptor<[], Anonymize<Ifvgo9568rpmqc>, false, never>;
    /**
     * Indices of disabled validators.
     *
     * The vec is always kept sorted so that we can find whether a given validator is
     * disabled using binary search. It gets cleared when `on_session_ending` returns
     * a new set of identities.
     */
    DisabledValidators: StorageDescriptor<[], Anonymize<I95g6i7ilua7lq>, false, never>;
    /**
     * The next session keys for a validator.
     */
    NextKeys: StorageDescriptor<[Key: SS58String], SizedHex<32>, true, never>;
    /**
     * The owner of a key. The key is the `KeyTypeId` + the encoded key.
     */
    KeyOwner: StorageDescriptor<[Key: Anonymize<I82jm9g7pufuel>], SS58String, true, never>;
    /**
     * Accounts whose keys were set via `SessionInterface` (external path) without
     * incrementing the consumer reference or placing a key deposit. `do_purge_keys`
     * only decrements consumers for accounts that were registered through the local
     * session pallet.
     */
    ExternallySetKeys: StorageDescriptor<[Key: SS58String], null, true, never>;
  };
  Aura: {
    /**
     * The current authority set.
     */
    Authorities: StorageDescriptor<[], Anonymize<Ic5m5lp1oioo8r>, false, never>;
    /**
     * The current slot of this block.
     *
     * This will be set in `on_initialize`.
     */
    CurrentSlot: StorageDescriptor<[], bigint, false, never>;
  };
  AuraExt: {
    /**
     * Serves as cache for the authorities.
     *
     * The authorities in AuRa are overwritten in `on_initialize` when we switch to a new session,
     * but we require the old authorities to verify the seal when validating a PoV. This will
     * always be updated to the latest AuRa authorities in `on_finalize`.
     */
    Authorities: StorageDescriptor<[], Anonymize<Ic5m5lp1oioo8r>, false, never>;
    /**
     * Current relay chain slot paired with a number of authored blocks.
     *
     * This is updated in [`FixedVelocityConsensusHook::on_state_proof`] with the current relay
     * chain slot as provided by the relay chain state proof.
     */
    RelaySlotInfo: StorageDescriptor<[], Anonymize<I6cs1itejju2vv>, true, never>;
  };
  Constitution: {
    /**
     * 02 §7.3 (frozen): `Params: map ParamKey → ParamRecord`.
     *
     * The key set is genesis-fixed at ≤ [`MAX_PARAMS`] entries — no call
     * inserts new keys (`set_param` updates existing records only), so the
     * map is bounded by construction (I-21); `try_state` re-asserts it.
     */
    Params: StorageDescriptor<[Key: SizedHex<16>], Anonymize<I19osbbvcedbnc>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForParams: StorageDescriptor<[], number, false, never>;
    /**
     * 02 §7.3 (frozen): `PhaseFlags: u32` bitset.
     *
     * Bit assignments (append-only): 0 shadow mode, 1 PARAM armed,
     * 2 TREASURY armed, 3 CODE/META armed, 4 sudo present, 5 ledger frozen
     * (PB-LEDGER-FREEZE), 6 dead-man engaged, 7 reserve-health flag;
     * bits 8–31 reserved. Reserved bits are rejected on every write path.
     */
    PhaseFlags: StorageDescriptor<[], number, false, never>;
    /**
     * 02 §12 (frozen forever, D-14): the 168-byte fixed-layout release
     * channel. SCALE for the wrapper is exactly the 168 raw bytes (no length
     * prefix), so a metadata-less reader parses by offset. Writers are
     * exhaustive: the execution guard via [`Pallet::note_release_channel`]
     * and the scoped constitution track (or its internal bare
     * `ConstitutionalValues` form) via [`Pallet::set_release_channel`].
     */
    ReleaseChannel: StorageDescriptor<[], SizedHex<168>, false, never>;
    /**
     * Generic bounded-meter primitive (the constitution's half of I-7):
     * empty at genesis — the I-17 envelope meters live with their owning
     * pallets (treasury issuance/outflow, guard upgrade-spacing; 15 §1).
     * Windows reset lazily per epoch on charge; refusals are strict no-ops.
     */
    Meters: StorageDescriptor<[], Anonymize<Iapa0pspj5na3t>, false, never>;
    /**
     * Capability table (06 §3.2 rows / §6.2): which proposal class may
     * exercise which constitution-mediated capability. Consulted by the
     * execution guard at dispatch (09 §1.2).
     */
    Capabilities: StorageDescriptor<[], Anonymize<I5ebvuao287pjg>, false, never>;
  };
  ConditionalLedger: {
    /**
     * Proposal vaults — `map ProposalId → VaultInfo` (03 §4; `VaultInfo` ≤ 224 B).
     * Count-bounded to `MaxLiveProposals(=32) + settling cohorts` by the pallets
     * that create vaults (there is no structural map bound; each value is
     * `MaxEncodedLen`).
     */
    Vaults: StorageDescriptor<[Key: bigint], Anonymize<I71v2rrt182hod>, true, never>;
    /**
     * Baseline vaults — `map EpochId → BaselineVaultInfo` (03 §4; ≤ 64 B).
     */
    BaselineVaults: StorageDescriptor<[Key: number], Anonymize<Ia03hjl5um8umc>, true, never>;
    /**
     * Positions — `double_map (PositionId, AccountId) → Balance` (02 §7.4 / 03 §4).
     * Key order is `(PositionId, AccountId)` so per-vault reaping drains a prefix.
     * Global growth is priced by [`Config::PositionDeposit`] (the economic bound).
     */
    Positions: StorageDescriptor<Anonymize<I1bd4sfsts9lp2>, bigint, false, never>;
    /**
     * Live `Positions` entries per account — `map AccountId → u32`, ≤
     * `MaxPositionsPerAccount` for non-protocol accounts (03 §4, L-6).
     */
    PositionCount: StorageDescriptor<[Key: SS58String], number, false, never>;
    /**
     * Outstanding supply per instrument — `map PositionId → Balance` (03 §4).
     */
    PositionTotals: StorageDescriptor<[Key: Anonymize<I5m1k92kcp4o6d>], bigint, false, never>;
    /**
     * Total position storage deposits currently held by the sovereign account,
     * accounted strictly outside `escrowed` (03 §4, L-2/L-6).
     */
    DepositsHeld: StorageDescriptor<[], bigint, false, never>;
    /**
     * Checked O(1) mirror of every proposal and Baseline vault's `escrowed`
     * field. Every escrow delta and terminal reap updates this in the same
     * storage transaction as the real USDC move (03 §5.4, I-4).
     */
    TotalEscrowed: StorageDescriptor<[], bigint, false, never>;
    /**
     * 03 §5.3a(4)/L-7: redemption fee withheld from completed payouts and
     * retained as sovereign surplus, awaiting `sweep_redemption_fees`.
     *
     * An **additive internal** item (02 §13 v17) — not a §7 contract-surface
     * key. It is monotone non-decreasing between sweeps: a charged redemption
     * increments it by exactly `gross − net`, an exempt one by zero, and the
     * sweep is the only operation that decrements it, atomically with the
     * transfer. It is never escrow, so it is excluded from every L-2 liability
     * term and is exactly the lawful surplus L-7 bounds.
     */
    RedemptionFeesAccrued: StorageDescriptor<[], bigint, false, never>;
    /**
     * Persistent exact I-4 undercollateralization latch. `true` means the last
     * reconciliation observed `liability > custody`; surplus is healthy.
     */
    LedgerDrifted: StorageDescriptor<[], boolean, false, never>;
    /**
     * Last exact comparison, retained so `try_state` can prove the latch was
     * derived from the specified inequality rather than an arbitrary writer.
     */
    LastReconciliation: StorageDescriptor<[], Anonymize<Ifkob0fdn3eods>, true, never>;
    /**
     * Block at which a proposal vault entered a terminal state, for the
     * `sweep_dust` archive-delay gate (03 §4/§5.4). Ledger-internal; not a FE
     * surface.
     */
    VaultTerminalAt: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Block at which a Baseline vault settled, for `sweep_dust_baseline`.
     */
    BaselineTerminalAt: StorageDescriptor<[Key: number], number, true, never>;
    /**
     * PB-RESERVE backstop. Only public split inflows consult this timestamp;
     * merge/redeem/transfer and authority recovery paths remain live.
     */
    SplitPausedUntil: StorageDescriptor<[], number, true, never>;
    /**
     * PB-LEDGER-FREEZE backstop for every public funds-moving ledger call.
     */
    FrozenUntil: StorageDescriptor<[], number, true, never>;
    /**
     * Independent one-renewal latch (06 §6.3).
     */
    FreezeRenewed: StorageDescriptor<[], boolean, false, never>;
  };
  Market: {
    /**
     * Present market books (02 §7.4), including terminal books retained through
     * the archive delay. The shared physical map is partitioned by the O(1)
     * protocol/external stored counters below: external retention can never
     * consume the protocol's 2,240-row archive envelope.
     */
    Markets: StorageDescriptor<[Key: bigint], Anonymize<I1ai0vm56bl7eu>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForMarkets: StorageDescriptor<[], number, false, never>;
    /**
     * Books whose durable ledger-terminal latch has not yet been observed.
     * Creation increments this counter and first terminal observation decrements
     * it in the same storage transaction; reap affects only the stored count.
     */
    ActiveMarketCount: StorageDescriptor<[], number, false, never>;
    /**
     * External books whose service-ledger terminal latch has not been observed.
     * Completely disjoint from [`ActiveMarketCount`] and `LivePolCommitments`.
     */
    ActiveExternalMarketCount: StorageDescriptor<[], number, false, never>;
    /**
     * External-domain rows in [`Markets`], live or retained. The retained
     * partition is derived from fastest lawful service throughput across the
     * archive horizon and applies backpressure without borrowing the protocol
     * archive budget.
     */
    StoredExternalMarketCount: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    ExternalBookPairs: StorageDescriptor<[Key: bigint], Anonymize<I7aij5ls86nd9l>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForExternalBookPairs: StorageDescriptor<[], number, false, never>;
    /**
     * O(1) membership index for dynamically allocated book and fee custody
     * accounts. Refcounts make the index correct even when a runtime or test
     * deliberately reuses an account across books; the retained entry count is
     * dispatch-bounded by `2 * MaxStoredMarkets`.
     */
    MarketProtocolAccounts: StorageDescriptor<[Key: SS58String], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForMarketProtocolAccounts: StorageDescriptor<[], number, false, never>;
    /**
     * Proposal-to-book inverse used to observe one ledger terminal marker in
     * O(BooksPerProposal), rather than scanning all live markets.
     */
    ProposalMarketIds: StorageDescriptor<[Key: bigint], Anonymize<Iafqnechp3omqg>, false, never>;
    /**
     * Epoch-to-Baseline-book lookup (02 §7.4, frozen name).
     */
    BaselineMarketOf: StorageDescriptor<[Key: number], bigint, true, never>;
    /**
     * Last sealed decision-window TWAP for each retained Baseline book.
     *
     * The epoch decision may need the previous epoch's Baseline before its
     * cohort summary is finalized at e+3. Capture the immutable value at the
     * market seal boundary instead of reading a live/in-flight window or
     * waiting for `RecentCohortSummaries` (05 §5.3, SQ-88). The entry follows
     * `BaselineMarketOf`'s market lifetime and is removed with that book.
     */
    SealedBaselineTwap: StorageDescriptor<[Key: number], bigint, true, never>;
    /**
     * Block at which a book closed, retained for the frozen integration
     * surface and lifecycle observability. Reap delay is settlement-anchored.
     */
    ClosedAt: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Markets whose POL headroom has already been seeded (04 §10), keyed to the
     * subsidy custody account that funded them. Guards `seed` against
     * re-splitting POL into an already-collateralized book (idempotence), and
     * names the account the 04 §2 Sweep returns that custody to, so the
     * permissionless crank cannot be pointed at a payee of the caller's
     * choosing (08 §8 step 5(b)). Removed at reap.
     *
     * **No migration accompanies the E1 value widening `()` → `AccountId`, and
     * that is deliberate.** Raised as a P1 by review, on the correct general
     * reasoning that an old zero-byte `()` value cannot decode as an
     * `AccountId`, so `contains_key` would report a market seeded while `get`
     * returned `None`. That failure needs a chain carrying pre-widening values,
     * and none exists: Bleavit is **pre-genesis** — no runtime is deployed, the
     * Track G rollout gates are unmet, and every environment that has ever held
     * this key is an ephemeral zombienet/chopsticks fixture rebuilt from
     * genesis. This is the same clause 02 §13 applies to v15, v16 and v17
     * ("Pre-genesis revision — no runtime is deployed, so §13's point-3
     * migration clause does not apply").
     *
     * The note is here rather than only in a review reply because the argument
     * is not visible from this file, so the next reader would reasonably raise
     * it again. **It expires at genesis:** once a runtime is deployed, any
     * further change to this value shape needs a real migration, and the repo's
     * standing constraint that additional MBMs require their own exhaustive
     * cutpoint repair (B15/B16) applies in full.
     */
    SeededMarkets: StorageDescriptor<[Key: bigint], SS58String, true, never>;
    /**
     * Books whose 04 §2 Sweep stage has run. Written in the same storage layer
     * as the two remittances, so a repeat call is a silent no-op rather than a
     * second payment and a partially applied sweep is unreachable. Reap
     * requires it in addition to the terminal latch and archive delay —
     * reap-before-sweep is the one ordering that must not be reachable, being
     * the only irreversible one. Removed with the `Markets` row.
     */
    SweptMarkets: StorageDescriptor<[Key: bigint], null, true, never>;
    /**
     * Monotonic internal id allocator used by epoch's bounded market-opening
     * orchestration. Zero means no id has yet been allocated.
     */
    NextMarketId: StorageDescriptor<[], bigint, false, never>;
    /**
     * O(1) accumulator checkpoints at registered full/trailing boundaries
     * (04 §7). Internal backing outside the frozen 02 §7.4 surface.
     */
    TwapCheckpoints: StorageDescriptor<[Key: bigint], Anonymize<I3hg4c9ge064lf>, false, never>;
    /**
     * Per-window coverage and staleness counters. A Baseline can serve
     * several proposal pairs, hence the same eight-entry bound as checkpoints.
     */
    DecisionWindows: StorageDescriptor<[Key: bigint], Anonymize<Iej87d0l2agljs>, false, never>;
    /**
     * Logical proposal consumers of registered windows. Baseline windows may
     * be shared by several proposals with identical boundaries; a sealed
     * window is prunable only after every listed decision has consumed it.
     */
    DecisionWindowOwners: StorageDescriptor<[Key: bigint], Anonymize<Ifr88cshss4mco>, false, never>;
    /**
     * Idempotence marker for the one extra seed that brings a guardian rerun
     * from its original POL allocation to the specified 2× allocation.
     */
    RerunSeededMarkets: StorageDescriptor<[Key: bigint], null, true, never>;
    /**
     * Durable market-side observation of the ledger terminal block. Unlike
     * the ledger's permissionlessly swept marker, this latch lives until the
     * corresponding market is reaped and therefore cannot resurrect POL.
     */
    SettlementObservedAt: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Exact live POL obligations, sorted by market id. Lifecycle mutations
     * update this one bounded value transactionally, so the treasury mirror
     * needs one storage read instead of a 196-key `Markets` trie scan.
     */
    LivePolCommitments: StorageDescriptor<[], Anonymize<I3qulnvnc3hn00>, false, never>;
    /**
     * PB-DEPEG backstop: new book creation/seeding is disabled only while
     * `now < until` (06 §6.2).
     */
    CreationFrozenUntil: StorageDescriptor<[], number, true, never>;
    /**
     * PB-LEDGER-FREEZE backstop for trading/observation calls (06 §6.3).
     */
    FrozenUntil: StorageDescriptor<[], number, true, never>;
    /**
     * Pallet-level one-renewal latch. Guardian core independently enforces the
     * same invariant; this prevents a miswired runtime adapter extending twice.
     */
    FreezeRenewed: StorageDescriptor<[], boolean, false, never>;
  };
  Welfare: {
    /**
     * Frozen 02 §7.4 frontend surface: versioned metric definitions.
     */
    MetricSpecs: StorageDescriptor<[Key: number], Anonymize<Iept8gvj9an6pj>, true, never>;
    /**
     * Frozen 02 §7.4 frontend surface: bounded settlement snapshots.
     */
    Snapshots: StorageDescriptor<[Key: Anonymize<I5g2vv0ckl2m8b>], Anonymize<I3ge8l11mhestc>, true, never>;
    /**
     * Pallet-internal 07 §10 settlement context, one entry per `Snapshots` key.
     */
    SnapshotContexts: StorageDescriptor<[Key: Anonymize<I5g2vv0ckl2m8b>], Anonymize<I4qqej82rtmcsa>, true, never>;
    /**
        
         */
    SnapshotDeadline: StorageDescriptor<[], Anonymize<I8el4qiut1afl1>, true, never>;
    /**
     * Frozen 02 §7.4 frontend surface: daily breach outcomes by epoch.
     */
    GateBreachFlags: StorageDescriptor<[Key: number], Anonymize<I2o134i87sa348>, true, never>;
    /**
     * Pallet-internal marker for successfully sampled daily gates.
     *
     * This is deliberately separate from the frozen `GateBreachFlags` surface:
     * 02 §7.4 names only `Snapshots`, `MetricSpecs`, and `GateBreachFlags`, and
     * 05 §4.7 requires the latter's bitmap to identify breached days only.
     * The auxiliary map is bounded and pruned in lockstep with gate history.
     */
    SampledGateDays: StorageDescriptor<[Key: number], Anonymize<I9jd27rnpm8ttv>, true, never>;
    /**
     * Local XCM transport/probe counters by `(epoch, day)` (09 §6.4).
     *
     * The future runtime `MetricInputs` binding computes v1 X as
     * `accepted / (accepted + failed + probe_timeouts)` over the requested
     * day/epoch window; no traffic means X = 1. This pallet records only the
     * three local signals and deliberately does not compute X. Entries are
     * reaped with the welfare rolling window by [`Pallet::prune`] and the
     * epoch-clock maintenance seam.
     */
    XcmTraffic: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Anonymize<I9v1nr5t25p3gu>, false, never>;
    /**
     * Bounded epoch prefixes which currently own XCM traffic entries.
     *
     * This lets tick-path maintenance reap traffic-only epochs without a
     * historical full-map scan. Bounded pruning can temporarily leave older
     * prefixes queued behind the retained window; the index remains capped.
     */
    XcmTrafficEpochs: StorageDescriptor<[], Anonymize<Icgljjb6j82uhn>, false, never>;
    /**
     * Day-resolved reserve-probe outcomes (07 §8 `R_daily`; SQ-195).
     *
     * `Some(true)` = that day's probe passed; `Some(false)` = it failed
     * (error response, timeout, or a folded no-attempt slot). **Absence is not
     * health**: 07 §8 has no benefit-of-the-doubt branch, so a completed day
     * with no entry scores 0 once the probe is armed. Before arming, `R` is
     * *unavailable* rather than 0 — the probe's own `ReserveProbeArmed` latch
     * says pre-arm slots are not outages, and scoring them as failures would
     * set the C breach flag out of a mechanism that never ran.
     *
     * Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
     * so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
     * its `u8`-bounded 256-day second key (I-20/I-21).
     */
    ReserveProbeDaily: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, boolean, true, never>;
    /**
     * Per-author authored-block counts by `(epoch, day)` (05 §4.3).
     *
     * The shared series behind three welfare components, all of which read
     * *distinct authors* or *authored blocks* over a window and none of which
     * can be reconstructed from an aggregate count: collator-set adequacy `K`
     * (`min(1, distinct_active_authors / collator.n_min)`, live since A14),
     * block production `U`, and collator concentration `D_eff` (§4.5), which
     * needs the per-author distribution and not merely its cardinality. One
     * series serves all three so the three can never disagree about who
     * authored what.
     *
     * This pallet records only the counts and deliberately computes no
     * component from them — the same division of labour [`XcmTraffic`] makes.
     *
     * Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
     * so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
     * its `u8`-bounded 256-day second key (I-20/I-21). The per-day vector is
     * bounded by [`Config::MaxCollatorAuthorshipEntries`] (13 §4).
     */
    CollatorAuthorship: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Anonymize<Ij23g2682mtlh>, false, never>;
    /**
     * The same series aggregated over an epoch's days, maintained **on write**
     * (05 §4.3).
     *
     * Deliberately stored rather than folded on read. The day dimension is
     * keyed by a `u8`, and the day index of the *live* epoch keeps advancing
     * while the clock is paused (05 §4.8 — the live epoch has no end bound), so
     * the fold's honest worst case is 256 day slots × the per-day bound: about
     * 1 MB of proof and a quadratic per-author merge, charged to
     * `record_snapshot` on every epoch. Restricting the fold to the epoch's
     * measurable days instead would make that charge a function of a
     * governance-tunable `epoch.length`, so the weight would silently
     * understate the moment the key moved. Maintaining the aggregate costs one
     * extra bounded read/write on the authorship path and makes the read O(1)
     * and constant.
     *
     * Its `truncated` flag is **its own**, not the disjunction of its days': the
     * aggregate is maintained independently, so a day that dropped an author
     * for want of room in *that day's* vector does not make the epoch-wide
     * distribution wrong. try-state ties the two together where both are
     * untruncated.
     *
     * Keyed by epoch only, and retired by the same bounded walk from the same
     * shared [`XcmTrafficEpochs`] index (I-20/I-21).
     */
    CollatorAuthorshipEpoch: StorageDescriptor<[Key: number], Anonymize<Ij23g2682mtlh>, false, never>;
    /**
     * Block-production counters by `(epoch, day)` (05 §4.3.2; A14).
     *
     * `U` and `U^{day}` are sums of the same per-block observation over
     * different windows, so one accumulator serves both granularities — the day
     * slots here, and the co-maintained epoch total in
     * [`BlockProductionEpoch`].
     *
     * This pallet records only the three terms and deliberately computes no
     * component from them — the same division of labour [`XcmTraffic`] makes,
     * and the reason `U`'s clamp and its zero-denominator rule live in the
     * runtime binding beside the other 05 §4.3 projections.
     *
     * Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
     * so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
     * its `u8`-bounded 256-day second key (I-20/I-21). The value is a
     * fixed-width counter triple, so the map adds no variable-length collection
     * of its own (13 §4).
     */
    BlockProduction: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Anonymize<Ib65ekpdoa117u>, false, never>;
    /**
     * Epoch-wide block-production totals, maintained **on write** (05 §4.3.2).
     *
     * Not a cache and not a derived convenience: it is what makes `U` at epoch
     * granularity an **O(1) dispatch read**. The day slots alone would force
     * `record_snapshot` to fold the whole `(epoch, ·)` prefix — up to 256 keys,
     * so up to 256 reads and ~645 KB of proof charged to one keeper crank
     * (I-20/I-21: a dispatch path pays for its worst case, and that worst case
     * is six times `record_snapshot`'s entire current PoV footprint). One extra
     * read/write on the already-`Mandatory`-charged per-block observation buys
     * that back at a fixed cost that does not grow with the window's length.
     *
     * Written only by [`Pallet::note_block_production`], in the same
     * index-gated step as the day slot, so the two can never disagree about a
     * dropped window; `do_try_state` asserts the equality in both directions,
     * and the shared reaper removes the total with the prefix it summarizes.
     *
     * Bounded by the same `XcmTrafficEpochs` index as [`BlockProduction`] — one
     * fixed-width entry per indexed epoch, so at most
     * `MAX_XCM_TRAFFIC_EPOCHS_BOUND` of them exist (13 §4).
     */
    BlockProductionEpoch: StorageDescriptor<[Key: number], Anonymize<Ib65ekpdoa117u>, false, never>;
    /**
     * Block-weight utilization accumulator by `(epoch, day)` (05 §4.3 `H`).
     *
     * Written once per block by [`Pallet::sample_block_weight`] from
     * `on_finalize`, because `frame_system::BlockWeight` is `kill`ed at the top
     * of every `initialize` and is therefore unreadable from anywhere else.
     * The runtime binding maps the window's mean to `H`; this pallet stores
     * only the accumulator. Keyed exactly like [`XcmTraffic`], so it inherits
     * that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index, its `u8`-bounded
     * 256-day second key, and its bounded retention walk (I-20/I-21).
     */
    BlockWeightSamples: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Anonymize<Ic9m8l8pkrt2k5>, false, never>;
    /**
     * The separately accumulated primary/system resource usage for the
     * current block. A parallel `(epoch, day)` sample is written at
     * finalization so `H` excludes external work while remaining in the same
     * physical `max_block` coordinate system as the total diagnostic sample.
     */
    PrimaryBlockWeightSamples: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Anonymize<Ic9m8l8pkrt2k5>, false, never>;
    /**
     * Current-block reservation ledger. It is replaced at the first
     * observation of a new block and consumed by `sample_block_weight`.
     */
    BlockResourceUsage: StorageDescriptor<[], Anonymize<Idjevvptm6gjaq>, true, never>;
    /**
     * Qualifying defensive-path failures by `(epoch, day)` (05 §4.3 `Π`).
     *
     * The **single** counter behind `Π = max(0, 1 − 0.25 · events)`, with
     * exactly one write path — [`Pallet::note_integrity_failure`] — so no site
     * can double-count an event (05 §4.3.2: "a single event increments it at
     * most once"). Saturating and per window; 05 §4.3.2 fixes the qualifying
     * class, and [`futarchy_primitives::integrity`] carries that test.
     *
     * Keyed and retired exactly like [`XcmTraffic`], sharing its prefix index.
     */
    IntegrityFailures: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, number, false, never>;
  };
  Oracle: {
    /**
     * 02 §7.2 (frozen): `Reporters: map AccountId → ReporterInfo`. Counted —
     * ≥ `orc.n_min = 3` full stakes are required before any attested component
     * admits (07 §3). Bounded by construction (the core rejects the 65th, I-21);
     * `try_state` re-asserts `≤ MAX_REPORTERS`.
     */
    Reporters: StorageDescriptor<[Key: SS58String], Anonymize<Id9gm4bteop71s>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForReporters: StorageDescriptor<[], number, false, never>;
    /**
     * 02 §7.2 (frozen): `Watchtowers: map AccountId → WatchtowerInfo`. Counted,
     * ≤ `wt.max = 16` seats (07 §4). Bounded by construction; `try_state` asserts.
     */
    Watchtowers: StorageDescriptor<[Key: SS58String], Anonymize<Ibk7vl3nqtkvjq>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForWatchtowers: StorageDescriptor<[], number, false, never>;
    /**
     * 02 §7.2 (frozen name; SQ-2 key): the live reporting rounds, keyed by the
     * `(component, epoch, spec_version)` **triple** so per-version games across a
     * MetricSpec activation boundary each get their own round (07 §2(4)). Bounded
     * by construction (≤ `MAX_ROUNDS`, core-enforced); `try_state` asserts.
     */
    Rounds: StorageDescriptor<Anonymize<Icj2nb69liuu24>, Anonymize<I25if6a41d56ra>, true, never>;
    /**
     * Internal (not FE-read): the round-one bond and terminal cap frozen when
     * each reporting game opens. Kept parallel to [`Rounds`] so the contract-v4
     * `RoundState` SCALE value remains byte-for-byte unchanged. One entry per
     * live round; the shared 128-game ceiling and `try_state` correspondence
     * bound this map.
     */
    RoundSchedules: StorageDescriptor<[Key: Anonymize<Icj2nb69liuu24>], Anonymize<Icm9f9h6nua3dd>, true, never>;
    /**
     * 02 §7.2 (frozen name; SQ-2 key): the settled component values, triple-keyed
     * like [`Rounds`]. Reaped at cohort settlement; each entry is quorum-,
     * recompute-, adjudication- or neutral-resolved (07 §13; I-18).
     */
    ComponentValues: StorageDescriptor<Anonymize<Icj2nb69liuu24>, Anonymize<I8hs8cgiei54sv>, true, never>;
    /**
     * 02 §7.2 (frozen): `ReserveHealth` — the deterministic reserve-probe state
     * (`R`, 07 §8). Single value; the zeroed default is a healthy, never-probed
     * reserve.
     */
    ReserveHealth: StorageDescriptor<[], Anonymize<I43pkljl3a50rq>, false, never>;
    /**
     * Internal monotone latch: the production funding/readiness gate was
     * satisfied before the first v1 reserve attempt opened. This cannot be
     * inferred from `last_query_id`: v0 advanced that counter even though its
     * production dispatcher was the no-op `()` and sent no message.
     */
    ReserveProbeArmed: StorageDescriptor<[], boolean, false, never>;
    /**
     * Block at which [`ReserveProbeArmed`] latched (07 §8; SQ-195).
     *
     * 07 §8 scores **zero** pre-arm wall-clock slots — "time before a complete
     * runnable probe existed is not retroactively classified as an outage" —
     * so the welfare `R` projection must know where measurement began. Without
     * it, an epoch in which the probe arms late can never read healthy no
     * matter how completely the post-arm days pass.
     */
    ReserveProbeArmedAt: StorageDescriptor<[], number, true, never>;
    /**
     * Internal (not FE-read): per-round watchtower acknowledgments, keyed by
     * `report_hash` (07 §13). Bounded to live games' acks by the core's
     * settle/escalate pruning; `try_state` asserts `≤ MAX_ACK_RECORDS`.
     */
    AckRecords: StorageDescriptor<[], Anonymize<Ic7ihfq9tebase>, false, never>;
    /**
     * Internal (not FE-read): watchtowers active in the current, not-yet-swept
     * epoch (07 §4 liveness). Bounded to the seat count; cleared each
     * `note_epoch_boundary` sweep.
     */
    WatchtowerActive: StorageDescriptor<[], Anonymize<Ic5m5lp1oioo8r>, false, never>;
    /**
     * Internal d20 latch: a game whose money leg is neutralized remains here
     * until its retained bond stack reaches a terminal resolution (07 §11),
     * paired with the block at which that retention expires.
     *
     * The deadline is what makes §11(1)'s "retention is bounded by the track's
     * own schedule" true of the implementation rather than only of the prose:
     * without it a round-`R_max` challenge whose verdict never lands is skipped
     * by every close crank forever, holding its bond stack in custody and one
     * of the [`MAX_ROUNDS_BOUND`] game slots (SQ-492).
     */
    MoneySettled: StorageDescriptor<[], Anonymize<Ia78sqv46skudk>, false, never>;
    /**
     * 07 §3's offense ladder, retained independently of the active roster
     * (contract v19).
     *
     * **Internal — deliberately not 02 §7 contract surface.** Without it the
     * ladder is unreachable: `deregister_reporter` returns the stake in full
     * and `register_reporter` re-seated a clean row, so the second-offense
     * slash and third-offense ejection cost two extrinsics to erase. A clean
     * exit leaves no row, so ordinary rotation cannot fill the bound; the rows
     * carry no balance, so the I-29 custody sum in [`Pallet::do_try_state`] is
     * unchanged by construction.
     */
    ReporterRecords: StorageDescriptor<[], Anonymize<I8kuj5ij9r87hi>, false, never>;
    /**
     * 07 §4 liveness latch: whether any round has existed since the last
     * watchtower sweep. Not inferable from `Rounds`, which a clean closure
     * empties before the boundary sweep runs (SQ-491).
     *
     * Deliberately carries no `try-state` check, unlike every other item here:
     * both of its values are reachable against both states of `Rounds` — true
     * with none live (a game reported and closed inside the epoch) and false
     * with one live (a game that spanned a sweep) — so there is no relation to
     * assert. Its correctness is behavioural and is pinned by the §4 liveness
     * tests instead.
     */
    RoundActivity: StorageDescriptor<[], boolean, false, never>;
    /**
     * Internal (not FE-read): the `(component, frozen version)` pairs the
     * MetricSpec registry declares deterministically recomputable (07 §2(4)/§9).
     * `recompute_proof` fails closed for anything absent. Seeded at genesis and
     * via [`Pallet::note_recomputable`] (welfare `register_spec`, B1a).
     *
     * Membership here is necessary but **not sufficient**: the settled value
     * comes from [`Config::RecomputeEngine`], and a runtime that binds `()` —
     * which this one does until A7 lands — refuses every payload. Declaring a
     * component recomputable therefore cannot, on its own, open a settlement
     * path (2026-08-10 security review).
     */
    Recomputable: StorageDescriptor<[], Anonymize<I95g6i7ilua7lq>, false, never>;
  };
  IncidentRegistry: {
    /**
     * Bonded filings — `double_map (EpochId, FilingId) → Filing` (07 §7). Each
     * value is `MaxEncodedLen`; the key count is bounded logically by
     * [`FilingCount`] (≤ `MaxFilingsPerEpoch` per epoch) × ≤
     * [`registry_core::MAX_LIVE_EPOCHS`] non-closed epochs, enforced by the core
     * and asserted in `try_state` (the ledger's `Positions` precedent — a map's
     * bound is its accounting, not a structural `BoundedVec`).
     */
    Filings: StorageDescriptor<Anonymize<I9jd27rnpm8ttv>, Anonymize<Ieupfkt3mtrjlc>, true, never>;
    /**
     * Live per-epoch filing count / id cursor — `map EpochId → u32` (07 §7).
     * Reaped at `close_epoch` so the ≤ 4-live-epoch bound stays concurrent.
     */
    FilingCount: StorageDescriptor<[Key: number], number, false, never>;
    /**
     * Derived aggregates — `map (EpochId, MetricSpecVersion) → FixedU64`
     * (07 §7, contract v14 / SQ-141): the `I` input (Incident) or
     * milestone-points input (Milestone) handed to welfare, **per frozen
     * MetricSpec version**. A cohort settles on its creation-time spec (I-16),
     * so an activation boundary leaves two versions consuming one measurement
     * epoch; a single value per epoch would fold claims governed by different
     * frozen targets and formulas into one number (G-1).
     *
     * A missing entry is **not** "no incidents" — see `Pallet::aggregate`.
     */
    Aggregates: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, bigint, true, never>;
    /**
     * Watchtower-acknowledgment dedup set — `(EpochId, FilingId, AccountId) → ()`
     * (07 §4/§7). Ledger-internal; the pallet enforces the "one ack per
     * watchtower per filing" rule the core models with its `ack_records` vec, so
     * the loaded core aggregate never has to carry it. Reaped with its epoch.
     */
    AckRecords: StorageDescriptor<Anonymize<I5eoome1iv99mc>, null, true, never>;
    /**
     * Block at which each epoch was closed out, for the `reap_epoch`
     * archive-delay gate (07 §7). Set at `close_epoch`, removed at `reap_epoch`;
     * ≤ `MAX_AGGREGATES` live keys. Also the durable "already closed" marker that,
     * together with the `FilingCount`-present precondition, makes close idempotent
     * across a reap (a reaped epoch has neither, so it cannot be re-closed).
     */
    ClosedAt: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, number, true, never>;
  };
  MilestoneRegistry: {
    /**
     * Bonded filings — `double_map (EpochId, FilingId) → Filing` (07 §7). Each
     * value is `MaxEncodedLen`; the key count is bounded logically by
     * [`FilingCount`] (≤ `MaxFilingsPerEpoch` per epoch) × ≤
     * [`registry_core::MAX_LIVE_EPOCHS`] non-closed epochs, enforced by the core
     * and asserted in `try_state` (the ledger's `Positions` precedent — a map's
     * bound is its accounting, not a structural `BoundedVec`).
     */
    Filings: StorageDescriptor<Anonymize<I9jd27rnpm8ttv>, Anonymize<Ieupfkt3mtrjlc>, true, never>;
    /**
     * Live per-epoch filing count / id cursor — `map EpochId → u32` (07 §7).
     * Reaped at `close_epoch` so the ≤ 4-live-epoch bound stays concurrent.
     */
    FilingCount: StorageDescriptor<[Key: number], number, false, never>;
    /**
     * Derived aggregates — `map (EpochId, MetricSpecVersion) → FixedU64`
     * (07 §7, contract v14 / SQ-141): the `I` input (Incident) or
     * milestone-points input (Milestone) handed to welfare, **per frozen
     * MetricSpec version**. A cohort settles on its creation-time spec (I-16),
     * so an activation boundary leaves two versions consuming one measurement
     * epoch; a single value per epoch would fold claims governed by different
     * frozen targets and formulas into one number (G-1).
     *
     * A missing entry is **not** "no incidents" — see `Pallet::aggregate`.
     */
    Aggregates: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, bigint, true, never>;
    /**
     * Watchtower-acknowledgment dedup set — `(EpochId, FilingId, AccountId) → ()`
     * (07 §4/§7). Ledger-internal; the pallet enforces the "one ack per
     * watchtower per filing" rule the core models with its `ack_records` vec, so
     * the loaded core aggregate never has to carry it. Reaped with its epoch.
     */
    AckRecords: StorageDescriptor<Anonymize<I5eoome1iv99mc>, null, true, never>;
    /**
     * Block at which each epoch was closed out, for the `reap_epoch`
     * archive-delay gate (07 §7). Set at `close_epoch`, removed at `reap_epoch`;
     * ≤ `MAX_AGGREGATES` live keys. Also the durable "already closed" marker that,
     * together with the `FilingCount`-present precondition, makes close idempotent
     * across a reap (a reaped epoch has neither, so it cannot be re-closed).
     */
    ClosedAt: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, number, true, never>;
  };
  FutarchyTreasury: {
    /**
     * The whole treasury accounting state (08 §1). Kept as one bounded value:
     * NAV — the base every outflow check reads — sums `main_usdc`, all line
     * balances, open stream remainders, pending outflows and POL commitments,
     * so the hot path needs the whole aggregate regardless. `MaxEncodedLen` is
     * bounded (rule 3); B5 may split hot items if PoV benchmarks demand it.
     */
    State: StorageDescriptor<[], Anonymize<Ifs8l7uhm2p84a>, false, never>;
    /**
     * Real USDC that has arrived in `MAIN` custody but is not yet folded into
     * [`State`]'s `main_usdc` — realized market-fee value (04 §2 Sweep),
     * transaction fees (08 §9) and the INSURANCE above-target overflow
     * (08 §1.2). `nav()` is computed from `main_usdc`, so custody alone raises
     * nothing; this is the recognition half of every such inflow.
     *
     * It is a small dedicated counter rather than a direct write to [`State`]
     * **because of the transaction-fee caller**: that path runs on every
     * USDC-paying extrinsic, and reading + writing the multi-kilobyte treasury
     * aggregate there would put the whole of it into every block's proof.
     * [`Pallet::load`] folds this value into `main_usdc` and [`Pallet::persist`]
     * clears it in the same write, so `nav()`, `treasury()`, try-state and every
     * mutation observe the credit immediately and exactly once.
     */
    PendingMainCredit: StorageDescriptor<[], bigint, false, never>;
    /**
     * 08 §1.2 / 03 §7 R-5: cumulative ledger residue swept into INSURANCE and
     * not yet reclaimed — the liability term of `T_ins`. Reported by the
     * ledger's `sweep_dust*` cranks through [`Pallet::note_swept_residue`],
     * because a transfer alone leaves the reserve target unable to track the
     * liability it backs.
     *
     * **Monotone in v1, deliberately.** 08 §1.2 requires the 03 §5.4
     * Merkle-archived claims payout to decrement it atomically with the
     * payment; that procedure is not yet specified, so the counter only rises
     * and `T_ins` is an over-estimate — INSURANCE retains more than it owes and
     * less overflows. Over-reserving is the safe direction, and no decrement is
     * invented here. `sweep_insurance` is explicitly *not* that path: it
     * identifies no claim and discharges no liability, so it MUST NOT decrement.
     */
    SweptResidueUnreclaimed: StorageDescriptor<[], bigint, false, never>;
    /**
     * Phase≤4 operations multisig: authorized to note Coretime renewal quotes
     * and, while the one-way latch is open, to top up only `OpsReserveProbe`
     * within the live runway ceiling (08 §1.1; 09 §4).
     */
    CoretimeQuoteAuthority: StorageDescriptor<[], SS58String, true, never>;
    /**
     * Irreversible closure of the temporary Phase≤4 ops-multisig funding
     * authority. The first successful positive `FutarchyTreasury` funding of
     * `OpsReserveProbe` sets this; changing the phase bit never reopens it.
     */
    BootstrapOpsFundingClosed: StorageDescriptor<[], boolean, false, never>;
    /**
     * Block at which the Phase-3→4 transition armed community distribution.
     * Absence is the fail-closed pre-Phase-4 state.
     */
    CommunityDistributionArmedAt: StorageDescriptor<[], number, true, never>;
    /**
     * Undistributed amount remaining in the derived community pot.
     */
    CommunityDistributionRemaining: StorageDescriptor<[], bigint, false, never>;
    /**
     * Number of successful bounded community schedules created.
     */
    CommunityScheduleCount: StorageDescriptor<[], number, false, never>;
    /**
     * Undistributed amount remaining in the derived trading-reward
     * `incentiv` pot (08 §2.1/§2.6). `fund_trading_rewards` moves it in both
     * directions in one call: the previous authorization's unspent remainder
     * is credited back first (never above
     * [`Config::IncentiveAllocationAmount`]), then the new authorization is
     * debited from the replenished figure.
     */
    IncentiveRemaining: StorageDescriptor<[], bigint, false, never>;
    /**
     * Number of successful lifetime trading-reward budget authorizations
     * (08 §2.6, *Bounds*). Completed authorizations do not replenish it —
     * returning a remainder credits [`IncentiveRemaining`] alone, never this
     * counter.
     */
    TradingRewardBudgetCount: StorageDescriptor<[], number, false, never>;
    /**
     * Ops-operated account funded on the Coretime chain (09 §4).
     */
    CoretimeRenewalAccount: StorageDescriptor<[], SizedHex<32>, true, never>;
    /**
     * Bounded authored-block shares awaiting the next Housekeeping payout.
     * Keeping one aggregate rather than an unbounded epoch history makes a
     * keeper outage fail by deferring payment, never by growing state without
     * limit.
     */
    CollatorAuthoredBlocks: StorageDescriptor<[], Anonymize<I205qrookusi3d>, false, never>;
    /**
     * Epoch whose authored shares are currently held in the accumulator.
     */
    CollatorAuthoredEpoch: StorageDescriptor<[], number, true, never>;
    /**
     * Registered collator count snapshotted when the pending epoch's first
     * authored block is observed. Retries must use the earning epoch's set,
     * not a later live session size.
     */
    CollatorAuthoredRegisteredCount: StorageDescriptor<[], number, true, never>;
    /**
     * One completed accumulator may remain pending while custody is
     * underfunded. Keeping it separate lets boundary-block authors start the
     * next epoch without mixing their shares into the old payout.
     */
    CollatorPendingBlocks: StorageDescriptor<[], Anonymize<I205qrookusi3d>, false, never>;
    /**
     * Epoch and registered-count snapshot paired with `CollatorPendingBlocks`.
     */
    CollatorPendingEpoch: StorageDescriptor<[], number, true, never>;
    /**
        
         */
    CollatorPendingRegisteredCount: StorageDescriptor<[], number, true, never>;
    /**
     * Fail-closed marker for the current authored-share accumulator. It is
     * moved to `CollatorPendingOverflowed` when the current accumulator is
     * rotated into the pending slot.
     */
    CollatorAuthoredOverflowed: StorageDescriptor<[], boolean, false, never>;
    /**
     * Fail-closed marker paired with the pending authored-share accumulator.
     */
    CollatorPendingOverflowed: StorageDescriptor<[], boolean, false, never>;
    /**
     * Epoch whose boundary-owned block was dropped because the pending slot
     * was already occupied. The marker is consumed when that epoch gets a
     * fresh current accumulator.
     */
    CollatorDroppedEpoch: StorageDescriptor<[], number, true, never>;
    /**
     * Last epoch whose compensation was committed. This prevents authorship
     * arriving after the Housekeeping payout from creating a second claim.
     */
    CollatorCompensationPaidEpoch: StorageDescriptor<[], number, true, never>;
  };
  Guardian: {
    /**
     * The seven elected council members (06 §5.1). `None` until genesis or the
     * first `set_members`; every workflow call requires it (`NotInitialized`).
     */
    Members: StorageDescriptor<[], Anonymize<Itdvhihql560g>, true, never>;
    /**
     * Per-seat bond ledger, parallel to [`Members`] (06 §5.1: 50,000 VIT held).
     * Slashed 50% on a failed review (§5.4); real `fungible` holds are B-track.
     */
    MemberBonds: StorageDescriptor<[], Anonymize<I3fphkj3rkb8d1>, false, never>;
    /**
     * Live proposed actions awaiting their fifth approval (06 §5.1; FE:
     * `guardian.PendingActions`). Expire un-dispatched after 3 days.
     */
    PendingActions: StorageDescriptor<[], Anonymize<Ie358p6da7iusl>, false, never>;
    /**
     * `(action_id, member)` approval tallies (06 §5.1; FE: `guardian.Approvals`).
     */
    Approvals: StorageDescriptor<[], Anonymize<Iqnbvitf7a7l3>, false, never>;
    /**
     * Open retrospective-review records with their 2-epoch deadlines (06 §5.4;
     * FE: `guardian.ReviewDeadlines`).
     */
    ReviewDeadlines: StorageDescriptor<[], Anonymize<I3i3q11ol0f2a8>, false, never>;
    /**
     * Currently active playbooks with expiry/renewal state (06 §6.2; FE:
     * `guardian.ActivePlaybooks`).
     */
    ActivePlaybooks: StorageDescriptor<[], Anonymize<Iihcv2ffgfdth>, false, never>;
    /**
     * Values-governed availability toggle for the six kernel-enumerated
     * routines. All six are enabled at genesis (06 §6.2).
     */
    PlaybookRegistered: StorageDescriptor<[Key: Anonymize<I5ss06mick4shb>], boolean, false, never>;
    /**
     * The "one guardian rerun per proposal, ever" ledger (06 §5.3).
     */
    RerunUsed: StorageDescriptor<[], Anonymize<Iafqnechp3omqg>, false, never>;
    /**
     * Allowance counters (06 §5.2; FE: `guardian.Allowances`).
     */
    Allowances: StorageDescriptor<[], Anonymize<I3a0nip7t7d0i7>, false, never>;
    /**
     * Monotonic action-id cursor.
     */
    NextActionId: StorageDescriptor<[], number, false, never>;
    /**
     * Last epoch observed, for lazy per-epoch allowance resets (mirrors the
     * core's `set_epoch`).
     */
    LastSeenEpoch: StorageDescriptor<[], number, false, never>;
    /**
     * Internal action→ratify-referendum join used to refund the review deposit.
     * Live cardinality is bounded by [`ReviewDeadlines`]. This value stays a
     * single `u32` so existing v0 storage remains decodable.
     */
    ReviewReferenda: StorageDescriptor<[Key: number], number, true, never>;
    /**
     * The second, upheld-veto referendum scheduled exactly for `DelayOnce`
     * actions (06 §5.4). A parallel map preserves the original v0 storage
     * encoding of [`ReviewReferenda`].
     */
    VetoReviewReferenda: StorageDescriptor<[Key: number], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForVetoReviewReferenda: StorageDescriptor<[], number, false, never>;
    /**
     * Reverse join for a failed `delay_once` review. The action record is
     * retained only until T12 leaves `Suspended`, so the surviving veto can
     * still enact even after the ordinary review referendum has failed and
     * the guardian action has otherwise become terminal.
     */
    VetoReviewActions: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForVetoReviewActions: StorageDescriptor<[], number, false, never>;
    /**
     * Exact per-action slices temporarily moved out of approver seat holds.
     */
    ReviewFrontingOf: StorageDescriptor<[Key: number], Anonymize<I67b4evvsj5s3g>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForReviewFrontingOf: StorageDescriptor<[], number, false, never>;
    /**
     * Departed members' residual bonds, held through term plus one epoch.
     */
    PendingBondReleases: StorageDescriptor<[], Anonymize<Ifolljjjlhmesh>, false, never>;
    /**
     * Deterministic recall substrate, retained for at most four epochs after
     * failure (longer only while a recall deposit is not yet refundable).
     */
    FailedActions: StorageDescriptor<[Key: number], Anonymize<I342jcra5dcalu>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForFailedActions: StorageDescriptor<[], number, false, never>;
    /**
     * Round-robin resume point for the bounded overdue-review settle sweep
     * (SQ-500). Holds the last action id the batch selected; the next block's
     * batch begins at the next overdue review *after* it and wraps to the head
     * of the list when it runs out.
     *
     * Without this the bound would silently break its own rule. Settling a
     * review is what removes it from the overdue set, so a plain
     * `take(GUARDIAN_MAINTENANCE_BATCH)` re-selects the same prefix on every
     * block — and a review whose settlement persistently fails (a missing
     * fronting or referendum join, say) stays in that prefix forever. With
     * enough such records the batch never reaches the valid overdue reviews
     * behind them, and their slash and recall are suppressed permanently: a
     * **skip** wearing the shape of a carry, which is exactly what 06 §5.4
     * forbids. Rotating the selection guarantees every overdue review is
     * attempted within `⌈overdue / GuardianMaintenanceBatch⌉` blocks whatever
     * any individual settlement does.
     */
    MaintenanceSweepCursor: StorageDescriptor<[], number, true, never>;
    /**
     * Round-robin resume point for the bounded [`FailedActions`] reap sweep
     * (SQ-500). Holds the last action id the maintenance hook examined; the
     * next block resumes *after* its storage key and wraps to the start of the
     * map once a sweep runs short of [`GUARDIAN_MAINTENANCE_BATCH`].
     *
     * A cursor rather than a plain `take(n)`: the map is iterated in hash order,
     * so re-reading the first `n` keys every block would reap those and starve
     * every key behind them. `OptionQuery` with a `None` default means an
     * upgraded chain starts a fresh sweep at the head of the map, so no
     * migration is required and no key is skipped.
     */
    FailedActionReapCursor: StorageDescriptor<[], number, true, never>;
  };
  Attestor: {
    /**
     * Elected bonded registry members (06 §8: `attestor.Members`). Empty until
     * genesis or the first `set_members`.
     */
    Members: StorageDescriptor<[], Anonymize<I6lfe132so20ih>, false, never>;
    /**
     * Flat bounded attestation ledger mirroring the core's `Vec<Attestation>`;
     * this exact shipped value shape is frozen in 02 §7.5. Exceeding the cap is
     * a rejected no-op (G-1).
     */
    Attestations: StorageDescriptor<[], Anonymize<It5jnbkpi46a7>, false, never>;
    /**
     * Bond bases independent of the active roster (02 §7.5, v10).
     */
    Liabilities: StorageDescriptor<[], Anonymize<I7emrdrb8oc4do>, false, never>;
    /**
     * Durable cause markers for records that lost their signer (02 §7.5, v10).
     */
    Revocations: StorageDescriptor<[], Anonymize<I4dcivh5duqno8>, false, never>;
    /**
     * Monotonic attestation id cursor.
     */
    NextAttestationId: StorageDescriptor<[], number, false, never>;
  };
  Epoch: {
    /**
     * Frozen 02 §7.1 post-qualification non-terminal proposal map.
     */
    Proposals: StorageDescriptor<[Key: bigint], Anonymize<Iflkot84bd90qk>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForProposals: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    EpochOf: StorageDescriptor<[], Anonymize<Ibphrfq348d9fn>, false, never>;
    /**
        
         */
    IntakeQueue: StorageDescriptor<[], Anonymize<Iafqnechp3omqg>, false, never>;
    /**
        
         */
    RecentCohortSummaries: StorageDescriptor<[], Anonymize<I1qevohso20t15>, false, never>;
    /**
        
         */
    Cohorts: StorageDescriptor<[Key: number], Anonymize<I3dp098duidkfr>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForCohorts: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    IntakeProposals: StorageDescriptor<[Key: bigint], Anonymize<Iflkot84bd90qk>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForIntakeProposals: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    Schedule: StorageDescriptor<[], Anonymize<I6o17cn2677nom>, false, never>;
    /**
        
         */
    EpochTimings: StorageDescriptor<[], Anonymize<Ias91rflo6ebo5>, false, never>;
    /**
     * Internal delayed-proposal→review-deadline join. The guardian effect
     * producer writes it atomically with `delay_once`; it is removed when T12
     * or T24 consumes the hold. Cardinality is bounded by `Proposals`.
     */
    GuardianReviewDeadlines: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForGuardianReviewDeadlines: StorageDescriptor<[], number, false, never>;
    /**
     * Purpose-specific T12 opening window. This is deliberately separate from
     * [`GuardianReviewDeadlines`], which retains the live `grd.review_dl`
     * accountability/slashing horizon (SQ-310).
     */
    GuardianReviewWindows: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForGuardianReviewWindows: StorageDescriptor<[], number, false, never>;
    /**
     * Explicit qualification-era preimage ownership. State alone is not an
     * ownership proof once a rerun transfers the pin to the execution guard.
     */
    QualificationPreimageRequests: StorageDescriptor<[Key: bigint], SizedHex<32>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForQualificationPreimageRequests: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    QualificationAuxiliaryPreimageRequests: StorageDescriptor<[Key: bigint], SizedHex<32>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForQualificationAuxiliaryPreimageRequests: StorageDescriptor<[], number, false, never>;
    /**
     * Security sizing certificate frozen when a proposal qualifies.  This is
     * an internal map: the public proposal view remains contract-stable.
     */
    ProposalSecurityTermsOf: StorageDescriptor<[Key: bigint], Anonymize<Idggr61fqjm503>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForProposalSecurityTermsOf: StorageDescriptor<[], number, false, never>;
    /**
     * Internal bounded USDC escrow liabilities, one per admitted proposal.
     */
    ProposalBonds: StorageDescriptor<[Key: bigint], Anonymize<I8fhaue1ob9s7m>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForProposalBonds: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    ResourceLocks: StorageDescriptor<[], Anonymize<I9mj1qagqpte76>, false, never>;
    /**
        
         */
    ProposalSchedules: StorageDescriptor<[Key: bigint], Anonymize<I44n5hoqkdsljm>, true, never>;
    /**
        
         */
    CohortSchedules: StorageDescriptor<[Key: number], Anonymize<I7rilbfprtfgq9>, true, never>;
    /**
        
         */
    NextProposalId: StorageDescriptor<[], bigint, false, never>;
    /**
        
         */
    RolloverCounts: StorageDescriptor<[], Anonymize<Ifip05kcrl65am>, false, never>;
    /**
     * Seed-entry snapshot of the funded proposal ids and their gate-book
     * shapes. Bounded by the qualified cohort cap and replaced every epoch.
     */
    FundedPolSlots: StorageDescriptor<[], Anonymize<I7dp3d6kokg6qm>, false, never>;
    /**
        
         */
    DeadMan: StorageDescriptor<[], Anonymize<I806t22dpi77ls>, false, never>;
    /**
     * Last relay parent accepted by the parachain inherent. The runtime glue
     * crosses the Cumulus boundary with this plain number only (I-24).
     */
    LastRelayParent: StorageDescriptor<[], number, true, never>;
    /**
        
         */
    DeadManDetector: StorageDescriptor<[], Anonymize<Ib9hqqd0dq5sja>, false, never>;
    /**
        
         */
    StaleEpochCutoff: StorageDescriptor<[], bigint, true, never>;
    /**
        
         */
    BaselineCarry: StorageDescriptor<[], Anonymize<I5g2vv0ckl2m8b>, true, never>;
    /**
     * PB-HALT-INTAKE's source-scoped intake pause. The value is a hard
     * pallet-level backstop: a stale guardian maintenance crank cannot keep
     * intake paused once `now >= until` (06 §6.2).
     */
    IntakePausedUntil: StorageDescriptor<[], number, true, never>;
    /**
     * The direct guardian `pause_intake` contribution, kept separate so a
     * playbook expiry cannot clear a longer direct pause (06 §5.2/§6.2).
     */
    GuardianIntakePausedUntil: StorageDescriptor<[], number, true, never>;
    /**
     * Cohorts whose e+1/e+2 gate window is missing a committed observation.
     *
     * This is the v1 `oracle_deadlock` producer for PB-ORACLE-VOID. It is
     * deliberately target-keyed: one failed cohort never authorizes VOID of
     * another. Cardinality is bounded by the four non-terminal cohorts and
     * asserted in try-state (05 §4.7; 06 §6.2; 07 §10).
     */
    PendingOracleVoids: StorageDescriptor<[Key: number], null, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForPendingOracleVoids: StorageDescriptor<[], number, false, never>;
    /**
     * The last epoch for which the 07 §4 watchtower liveness sweep has run.
     *
     * `None` before the first observed epoch crossing. Runtime-internal: the
     * value orders one keeper-driven callback and appears in no 02 surface.
     */
    LastWatchtowerSweep: StorageDescriptor<[], number, true, never>;
    /**
     * The next measurement epoch whose 07 §11(1) `OracleSettleDeadline` has not
     * been driven; every `m` strictly below it has been force-neutralized.
     *
     * A cursor rather than a per-epoch flag because `sync_phase` can advance the
     * index by more than one, so several deadlines can fall due at once and the
     * catch-up must be both resumable and bounded (`ORACLE_DEADLINE_CATCHUP`).
     *
     * Defaults to 0 and is deliberately *not* initialized abreast of the clock by
     * a migration. A cursor that starts at the current index would claim coverage
     * it never provided. A chain that gains this seam by upgrade therefore
     * replays from 0, which costs bounded no-op work (reaped epochs have no
     * rounds and no expected components) for as many cranks as the catch-up
     * needs, and never a silent gap. Cohort coverage does **not** consult it:
     * see leg (3) of `drive_oracle_boundaries_inner`.
     */
    OracleDeadlineCursor: StorageDescriptor<[], number, false, never>;
  };
  ExecutionGuard: {
    /**
     * Frozen 02 §7.4 names and key/value shapes.
     */
    Queue: StorageDescriptor<[Key: bigint], Anonymize<Icqilkshp1mtl>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForQueue: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    Ratifications: StorageDescriptor<[Key: bigint], Anonymize<I2rc77s0mqdebl>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForRatifications: StorageDescriptor<[], number, false, never>;
    /**
     * Referendum identity bound by the CODE/META proposer before ratification
     * passes. This is an internal join: it is mirrored into the queue at
     * admission, retained across a non-terminal rerun, and consumed only
     * when the ratification passes or the proposal becomes terminal. It never
     * appears in the frozen 02 queue view.
     */
    PendingRatifications: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForPendingRatifications: StorageDescriptor<[], number, false, never>;
    /**
        
         */
    ExecutionRecords: StorageDescriptor<[], Anonymize<I2uoo9t5ta92pd>, false, never>;
    /**
        
         */
    PendingUpgrade: StorageDescriptor<[], Anonymize<I2og4uv7220vja>, true, never>;
    /**
        
         */
    CurrentSpecName: StorageDescriptor<[], Anonymize<I8dfqph7nh6ls>, true, never>;
    /**
        
         */
    HeldResources: StorageDescriptor<[], Anonymize<I60nr0tc614tgj>, false, never>;
    /**
        
         */
    HardGateBreach: StorageDescriptor<[], boolean, false, never>;
    /**
        
         */
    DeadManFreeze: StorageDescriptor<[], boolean, false, never>;
    /**
        
         */
    MigrationHalt: StorageDescriptor<[], boolean, false, never>;
    /**
     * Epoch-scoped guardian suspension. It is effective only while the runtime
     * projection reports the same current epoch and the hard-gate flag remains
     * live (06 §5.2; 09 §1.2 check 9).
     */
    GateSuspension: StorageDescriptor<[], number, true, never>;
    /**
     * Queue-time-frozen expedited-lane bit; kept outside the frozen Queue value.
     */
    Expedited: StorageDescriptor<[Key: bigint], boolean, false, never>;
    /**
        
         */
    LastUpgradeAuthorized: StorageDescriptor<[], number, true, never>;
    /**
     * Bounded proof trail for the guard-owned I-7/I-17 meter. Each entry is
     * `(authorized_at, spacing_enforced_for_this_authorization)`; expedited
     * recovery entries use zero for the normative exemption.
     */
    UpgradeSpacingHistory: StorageDescriptor<[], Anonymize<I95g6i7ilua7lq>, false, never>;
    /**
     * One-block application latch. The relay callback runs after the current
     * block's initialization, so the next `on_initialize` is the first point
     * at which the newly installed runtime's MBM cursor can be observed.
     */
    PendingAnchorCapture: StorageDescriptor<[], boolean, false, never>;
    /**
     * PB-MIGRATION's application-time anchor: the number and committed hash
     * of the last block before the new image's migrations could step.
     */
    PreMigrationAnchor: StorageDescriptor<[], Anonymize<I4p5t2krb1gmvp>, true, never>;
    /**
     * The target whose application was successfully scheduled in Cumulus.
     * This is deliberately distinct from authorization: relay `Abort` can
     * consume the Cumulus pending code only after this latch is present.
     */
    ScheduledUpgrade: StorageDescriptor<[], SizedHex<32>, true, never>;
    /**
     * Queue-time-frozen `(attestation_id, artifact_hash)` commitment. The
     * frozen Queue layout has no artifact-hash field; this bounded auxiliary
     * map prevents a mutable id→artifact projection from changing meaning
     * after admission (09 §1.1(3)/§1.2(5)).
     */
    AttestationBindings: StorageDescriptor<[Key: bigint], Anonymize<I4p5t2krb1gmvp>, true, never>;
    /**
     * The recovery image committed by the currently authorized CODE/META
     * mandate. Its full Wasm lives in pallet-preimage and stays requested
     * until the primary image finishes without an MBM, its MBM completes, or
     * this image is applied.
     */
    RecoveryImage: StorageDescriptor<[], Anonymize<I5lf8t4evk0fq7>, true, never>;
    /**
        
         */
    QueuedRecoveryImages: StorageDescriptor<[Key: bigint], Anonymize<Ic23t0smeuk6mq>, true, never>;
    /**
     * A recovery image qualified while the chain is healthy. Qualification is
     * a separately weighted, one-image operation so the epoch's ten-item tick
     * batch never multiplies a full-runtime-Wasm proof. The preimage request
     * owned by this entry transfers to `QueuedRecoveryImages` at enqueue.
     */
    QualifiedRecoveryImages: StorageDescriptor<[Key: bigint], Anonymize<Iacpni5fp46chb>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForQualifiedRecoveryImages: StorageDescriptor<[], number, false, never>;
    /**
     * Recovery-image pins retained across the proposal's non-terminal rerun
     * cycle. Ownership transfers back to `QueuedRecoveryImages` on re-enqueue
     * without issuing a second preimage request.
     */
    RerunRecoveryPins: StorageDescriptor<[Key: bigint], Anonymize<Ic23t0smeuk6mq>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForRerunRecoveryPins: StorageDescriptor<[], number, false, never>;
    /**
     * Ephemeral context visible only while the guard dispatches one already-
     * validated upgrade batch. It prevents the public call surface from
     * creating an unbound recovery commitment.
     */
    ExecutingUpgrade: StorageDescriptor<[], Anonymize<Ie1r5megrresvn>, true, never>;
    /**
     * One-shot Phase-3→4 bridge state. Relay Abort returns `Pending` to
     * `Unused`; only observed code application makes it permanently consumed.
     */
    PhaseFourBridge: StorageDescriptor<[], Anonymize<Icrbds76ujpbkg>, false, never>;
    /**
     * Payload pins retained while a queued proposal is in a rerun cycle.
     * This internal bounded marker transfers the existing pin back into a
     * later queue entry without an unpinned interval or a double request.
     */
    RerunPins: StorageDescriptor<[Key: bigint], SizedHex<32>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForRerunPins: StorageDescriptor<[], number, false, never>;
  };
  InflowCaps: {
    /**
     * Per-account cumulative XCM USDC inflow over Phase 3 (`09 §5.2`).
     *
     * The map is Phase-3-scoped: it has at most one entry per depositing
     * account and is retired when Phase 5 installs the unbounded sentinel.
     */
    CumulativeDeposits: StorageDescriptor<[Key: SS58String], bigint, false, never>;
  };
  ClientRegistry: {
    /**
     * Canonical forward registry (16 §2).
     */
    Clients: StorageDescriptor<[Key: number], Anonymize<Ifcik8ed7tl04e>, true, never>;
    /**
     * Exact-equality reverse registry. No prefix, alias, or descended-origin
     * matching exists anywhere in this pallet.
     */
    ClientIdOf: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], number, true, never>;
    /**
     * Exact-equality reverse index for locally authenticated services.
     */
    ClientIdOfSigner: StorageDescriptor<[Key: SS58String], number, true, never>;
    /**
     * The sub-id presence policy is not part of 02 §4a's frozen client row.
     */
    ClientPolicies: StorageDescriptor<[Key: number], Anonymize<I8jh0enk7f0r9l>, true, never>;
    /**
     * Local account funding the native hold. Kept out of the canonical record
     * because it is custody metadata, not external client identity.
     */
    BondOwners: StorageDescriptor<[Key: number], SS58String, true, never>;
    /**
     * Removal tombstone. The canonical rows stay live while questions drain.
     */
    RemovedClients: StorageDescriptor<[Key: number], null, true, never>;
    /**
     * TH-67 ingress plus I-36's isolated per-client egress diagnostics.
     */
    IngressMeters: StorageDescriptor<[Key: number], Anonymize<Icu5tfrap3ledf>, false, never>;
    /**
        
         */
    ClientCount: StorageDescriptor<[], number, false, never>;
    /**
     * Monotone allocator. Client ids are never reused after removal.
     */
    NextClientId: StorageDescriptor<[], number, false, never>;
  };
  QuestionService: {
    /**
     * Contract-v22 question index (introduced at v21; 02 §4a).
     */
    Questions: StorageDescriptor<[Key: bigint], Anonymize<I7jbmorihvfg1b>, true, never>;
    /**
     * Counter for the related counted storage map
     */
    CounterForQuestions: StorageDescriptor<[], number, false, never>;
    /**
     * Contract-v22 immutable report index (introduced at v21; 02 §4a).
     */
    Reports: StorageDescriptor<[Key: bigint], Anonymize<I7tusvhvaa2qim>, true, never>;
    /**
     * Bounded internal terms not sold as part of the frozen frontend row.
     */
    Terms: StorageDescriptor<[Key: bigint], Anonymize<Iar9rrgd5eqf9n>, true, never>;
    /**
     * One marker per named attestor, bounded by 16 per retained question.
     */
    AttestorBonds: StorageDescriptor<Anonymize<I96rqo4i9p11oo>, null, true, never>;
    /**
     * Latest in-window submission; overwrites are intentional (16 §6.3).
     */
    Attestations: StorageDescriptor<Anonymize<I96rqo4i9p11oo>, bigint, true, never>;
    /**
     * Legacy/eager per-question pause marker retained for state compatibility.
     * New pauses use the O(1) monotone cutoff below; either representation keeps
     * the mandatory VOID edge after expiry or playbook reversion.
     */
    PauseAffected: StorageDescriptor<[Key: bigint], null, true, never>;
    /**
     * Monotone service-id cutoff captured whenever intake is paused. Every
     * question below it existed before that pause and therefore keeps the
     * mandatory VOID edge after the pause expires or is cleared. The monotone
     * allocator makes this O(1); scanning retained history here would turn the
     * archive-capacity bound into a dispatch-time bound.
     */
    PauseQuestionCutoff: StorageDescriptor<[], bigint, false, never>;
    /**
        
         */
    PausedUntil: StorageDescriptor<[], number, true, never>;
    /**
        
         */
    NextServiceId: StorageDescriptor<[], bigint, false, never>;
    /**
        
         */
    LiveQuestionCount: StorageDescriptor<[], number, false, never>;
    /**
     * Aggregate posted external subsidy over live questions, in cash
     * (`Σ 2·b·ln 2`) — the external side of 16 §8.4's arming condition.
     *
     * Exists because that condition had no implementation at all (SQ-575). It
     * is a running total rather than a fold over `Terms` because the check runs
     * on every `register` and `Terms` is unbounded in principle; a fold would
     * put an O(live) read on an extrinsic that must stay O(1).
     */
    LiveExternalDepth: StorageDescriptor<[], bigint, false, never>;
    /**
     * 16 §8.6 scarcity state: `(multiplier, block last raised, decay window)`.
     *
     * The window is stored rather than re-read because `svc.max_window` is
     * amendable: decaying against the live row would let one amendment expire
     * every outstanding price at once, and §8.6 says the price moves down only
     * gradually. Each stored price decays on the schedule that was in force
     * when it was set.
     *
     * `None` means the multiplier is at its floor of 1 — the flat tariff — so
     * the common case costs one read and no arithmetic. Decay is applied
     * lazily on read rather than by a hook: nothing else needs the value
     * between registrations, and a hook would spend block weight every block
     * to maintain a number only `register` consumes.
     */
    ScarcityMultiplier: StorageDescriptor<[], Anonymize<Iilpsjpsgmkpu>, true, never>;
  };
  ServiceLedger: {
    /**
     * Proposal vaults — `map ProposalId → VaultInfo` (03 §4; `VaultInfo` ≤ 224 B).
     * Count-bounded to `MaxLiveProposals(=32) + settling cohorts` by the pallets
     * that create vaults (there is no structural map bound; each value is
     * `MaxEncodedLen`).
     */
    Vaults: StorageDescriptor<[Key: bigint], Anonymize<I71v2rrt182hod>, true, never>;
    /**
     * Baseline vaults — `map EpochId → BaselineVaultInfo` (03 §4; ≤ 64 B).
     */
    BaselineVaults: StorageDescriptor<[Key: number], Anonymize<Ia03hjl5um8umc>, true, never>;
    /**
     * Positions — `double_map (PositionId, AccountId) → Balance` (02 §7.4 / 03 §4).
     * Key order is `(PositionId, AccountId)` so per-vault reaping drains a prefix.
     * Global growth is priced by [`Config::PositionDeposit`] (the economic bound).
     */
    Positions: StorageDescriptor<Anonymize<I1bd4sfsts9lp2>, bigint, false, never>;
    /**
     * Live `Positions` entries per account — `map AccountId → u32`, ≤
     * `MaxPositionsPerAccount` for non-protocol accounts (03 §4, L-6).
     */
    PositionCount: StorageDescriptor<[Key: SS58String], number, false, never>;
    /**
     * Outstanding supply per instrument — `map PositionId → Balance` (03 §4).
     */
    PositionTotals: StorageDescriptor<[Key: Anonymize<I5m1k92kcp4o6d>], bigint, false, never>;
    /**
     * Total position storage deposits currently held by the sovereign account,
     * accounted strictly outside `escrowed` (03 §4, L-2/L-6).
     */
    DepositsHeld: StorageDescriptor<[], bigint, false, never>;
    /**
     * Checked O(1) mirror of every proposal and Baseline vault's `escrowed`
     * field. Every escrow delta and terminal reap updates this in the same
     * storage transaction as the real USDC move (03 §5.4, I-4).
     */
    TotalEscrowed: StorageDescriptor<[], bigint, false, never>;
    /**
     * 03 §5.3a(4)/L-7: redemption fee withheld from completed payouts and
     * retained as sovereign surplus, awaiting `sweep_redemption_fees`.
     *
     * An **additive internal** item (02 §13 v17) — not a §7 contract-surface
     * key. It is monotone non-decreasing between sweeps: a charged redemption
     * increments it by exactly `gross − net`, an exempt one by zero, and the
     * sweep is the only operation that decrements it, atomically with the
     * transfer. It is never escrow, so it is excluded from every L-2 liability
     * term and is exactly the lawful surplus L-7 bounds.
     */
    RedemptionFeesAccrued: StorageDescriptor<[], bigint, false, never>;
    /**
     * Persistent exact I-4 undercollateralization latch. `true` means the last
     * reconciliation observed `liability > custody`; surplus is healthy.
     */
    LedgerDrifted: StorageDescriptor<[], boolean, false, never>;
    /**
     * Last exact comparison, retained so `try_state` can prove the latch was
     * derived from the specified inequality rather than an arbitrary writer.
     */
    LastReconciliation: StorageDescriptor<[], Anonymize<Ifkob0fdn3eods>, true, never>;
    /**
     * Block at which a proposal vault entered a terminal state, for the
     * `sweep_dust` archive-delay gate (03 §4/§5.4). Ledger-internal; not a FE
     * surface.
     */
    VaultTerminalAt: StorageDescriptor<[Key: bigint], number, true, never>;
    /**
     * Block at which a Baseline vault settled, for `sweep_dust_baseline`.
     */
    BaselineTerminalAt: StorageDescriptor<[Key: number], number, true, never>;
    /**
     * PB-RESERVE backstop. Only public split inflows consult this timestamp;
     * merge/redeem/transfer and authority recovery paths remain live.
     */
    SplitPausedUntil: StorageDescriptor<[], number, true, never>;
    /**
     * PB-LEDGER-FREEZE backstop for every public funds-moving ledger call.
     */
    FrozenUntil: StorageDescriptor<[], number, true, never>;
    /**
     * Independent one-renewal latch (06 §6.3).
     */
    FreezeRenewed: StorageDescriptor<[], boolean, false, never>;
  };
  TradingRewards: {
    /**
     * The enrolled roster (08 §2.6). Bounded by [`MAX_PARTICIPANTS`] through
     * [`ParticipantCount`], which `enroll` checks before taking any hold.
     */
    Participants: StorageDescriptor<[Key: SS58String], Anonymize<Iccj220c6e0rai>, true, never>;
    /**
     * Per-account, per-market accumulators. TR4 writes them on each fill and
     * TR5 folds and deletes them.
     */
    Scores: StorageDescriptor<Anonymize<I95l2k9b1re95f>, Anonymize<I8nofrgats4bb6>, true, never>;
    /**
     * O(1) mirror of each account's [`Scores`] prefix length. TR4 bounds it.
     */
    ScoreCount: StorageDescriptor<[Key: SS58String], number, false, never>;
    /**
     * O(1) mirror of the [`Participants`] map length, so the roster bound is
     * enforced without iterating a map.
     */
    ParticipantCount: StorageDescriptor<[], number, false, never>;
    /**
     * O(1) mirror of the summed unclaimed `accrued` USDC across the roster.
     * TR5's budget scaling reads it; `try-state` binds it to the records.
     */
    TotalAccrued: StorageDescriptor<[], bigint, false, never>;
  };
};
type ICalls = {
  System: {
    /**
     * Make some on-chain remark.
     *
     * Can be executed by every `origin`.
     */
    remark: TxDescriptor<Anonymize<I8ofcg5rbj0g2c>>;
    /**
     * Set the number of pages in the WebAssembly environment's heap.
     */
    set_heap_pages: TxDescriptor<Anonymize<I4adgbll7gku4i>>;
    /**
     * Set the new runtime code.
     */
    set_code: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
    /**
     * Set the new runtime code without doing any checks of the given `code`.
     *
     * Note that runtime upgrades will not run if this is called with a not-increasing spec
     * version!
     */
    set_code_without_checks: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
    /**
     * Set some items of storage.
     */
    set_storage: TxDescriptor<Anonymize<I9pj91mj79qekl>>;
    /**
     * Kill some items from storage.
     */
    kill_storage: TxDescriptor<Anonymize<I39uah9nss64h9>>;
    /**
     * Kill all storage items with a key that starts with the given prefix.
     *
     * **NOTE:** We rely on the Root origin to provide us the number of subkeys under
     * the prefix we are removing to accurately calculate the weight of this function.
     */
    kill_prefix: TxDescriptor<Anonymize<Ik64dknsq7k08>>;
    /**
     * Make some on-chain remark and emit event.
     */
    remark_with_event: TxDescriptor<Anonymize<I8ofcg5rbj0g2c>>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * This call requires Root origin.
     */
    authorize_upgrade: TxDescriptor<Anonymize<Ib51vk42m1po4n>>;
    /**
     * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
     * later.
     *
     * WARNING: This authorizes an upgrade that will take place without any safety checks, for
     * example that the spec name remains the same and that the version number increases. Not
     * recommended for normal use. Use `authorize_upgrade` instead.
     *
     * This call requires Root origin.
     */
    authorize_upgrade_without_checks: TxDescriptor<Anonymize<Ib51vk42m1po4n>>;
    /**
     * Provide the preimage (runtime binary) `code` for an upgrade that has been authorized.
     *
     * If the authorization required a version check, this call will ensure the spec name
     * remains unchanged and that the spec version has increased.
     *
     * Depending on the runtime's `OnSetCode` configuration, this function may directly apply
     * the new `code` in the same block or attempt to schedule the upgrade.
     *
     * All origins are allowed.
     */
    apply_authorized_upgrade: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
  };
  Timestamp: {
    /**
     * Set the current time.
     *
     * This call should be invoked exactly once per block. It will panic at the finalization
     * phase, if this call hasn't been invoked by that time.
     *
     * The timestamp should be greater than the previous one by the amount specified by
     * [`Config::MinimumPeriod`].
     *
     * The dispatch origin for this call must be _None_.
     *
     * This dispatch class is _Mandatory_ to ensure it gets executed in the block. Be aware
     * that changing the complexity of this call could result exhausting the resources in a
     * block to execute any other calls.
     *
     * ## Complexity
     * - `O(1)` (Note that implementations of `OnTimestampSet` must also be `O(1)`)
     * - 1 storage read and 1 storage mutation (codec `O(1)` because of `DidUpdate::take` in
     * `on_finalize`)
     * - 1 event handler `on_timestamp_set`. Must be `O(1)`.
     */
    set: TxDescriptor<Anonymize<Idcr6u6361oad9>>;
  };
  ParachainSystem: {
    /**
     * Set the current validation data.
     *
     * This should be invoked exactly once per block. It will panic at the finalization
     * phase if the call was not invoked.
     *
     * The dispatch origin for this call must be `Inherent`
     *
     * As a side effect, this function upgrades the current validation function
     * if the appropriate time has come.
     */
    set_validation_data: TxDescriptor<Anonymize<Ial23jn8hp0aen>>;
    /**
        
         */
    sudo_send_upward_message: TxDescriptor<Anonymize<Ifpj261e8s63m3>>;
  };
  Balances: {
    /**
     * Transfer some liquid free balance to another account.
     *
     * `transfer_allow_death` will set the `FreeBalance` of the sender and receiver.
     * If the sender's account is below the existential deposit as a result
     * of the transfer, the account will be reaped.
     *
     * The dispatch origin for this call must be `Signed` by the transactor.
     */
    transfer_allow_death: TxDescriptor<Anonymize<I4ktuaksf5i1gk>>;
    /**
     * Exactly as `transfer_allow_death`, except the origin must be root and the source account
     * may be specified.
     */
    force_transfer: TxDescriptor<Anonymize<I9bqtpv2ii35mp>>;
    /**
     * Same as the [`transfer_allow_death`] call, but with a check that the transfer will not
     * kill the origin account.
     *
     * 99% of the time you want [`transfer_allow_death`] instead.
     *
     * [`transfer_allow_death`]: struct.Pallet.html#method.transfer
     */
    transfer_keep_alive: TxDescriptor<Anonymize<I4ktuaksf5i1gk>>;
    /**
     * Transfer the entire transferable balance from the caller account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any locked, reserved, or existential deposits (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the account has, causing the sender account to be killed (false), or
     * transfer everything except at least the existential deposit, which will guarantee to
     * keep the sender account alive (true).
     */
    transfer_all: TxDescriptor<Anonymize<I9j7pagd6d4bda>>;
    /**
     * Unreserve some balance from a user by force.
     *
     * Can only be called by ROOT.
     */
    force_unreserve: TxDescriptor<Anonymize<I2h9pmio37r7fb>>;
    /**
     * Upgrade a specified account.
     *
     * - `origin`: Must be `Signed`.
     * - `who`: The account to be upgraded.
     *
     * This will waive the transaction fee if at least all but 10% of the accounts needed to
     * be upgraded. (We let some not have to be upgraded just in order to allow for the
     * possibility of churn).
     */
    upgrade_accounts: TxDescriptor<Anonymize<Ibmr18suc9ikh9>>;
    /**
     * Set the regular balance of a given account.
     *
     * The dispatch origin for this call is `root`.
     */
    force_set_balance: TxDescriptor<Anonymize<I9iq22t0burs89>>;
    /**
     * Adjust the total issuance in a saturating way.
     *
     * Can only be called by root and always needs a positive `delta`.
     *
     * # Example
     */
    force_adjust_total_issuance: TxDescriptor<Anonymize<I5u8olqbbvfnvf>>;
    /**
     * Burn the specified liquid free balance from the origin account.
     *
     * If the origin's account ends up below the existential deposit as a result
     * of the burn and `keep_alive` is false, the account will be reaped.
     *
     * Unlike sending funds to a _burn_ address, which merely makes the funds inaccessible,
     * this `burn` operation will reduce total issuance by the amount _burned_.
     */
    burn: TxDescriptor<Anonymize<I5utcetro501ir>>;
  };
  ForeignAssets: {
    /**
     * Issue a new class of fungible assets from a public origin.
     *
     * This new asset class has no assets initially and its owner is the origin.
     *
     * The origin must conform to the configured `CreateOrigin` and have sufficient funds free.
     *
     * Funds of sender are reserved by `AssetDeposit`.
     *
     * Parameters:
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `admin`: The admin of this class of assets. The admin is the initial address of each
     * member of the asset class's admin team.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `Created` event when successful.
     *
     * Weight: `O(1)`
     */
    create: TxDescriptor<Anonymize<I7t2thek61ghou>>;
    /**
     * Issue a new class of fungible assets from a privileged origin.
     *
     * This new asset class has no assets initially.
     *
     * The origin must conform to `ForceOrigin`.
     *
     * Unlike `create`, no funds are reserved.
     *
     * - `id`: The identifier of the new asset. This must not be currently in use to identify
     * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
     * - `owner`: The owner of this class of assets. The owner has full superuser permissions
     * over this asset, but may later change and configure the permissions using
     * `transfer_ownership` and `set_team`.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     *
     * Emits `ForceCreated` event when successful.
     *
     * Weight: `O(1)`
     */
    force_create: TxDescriptor<Anonymize<I61tdrsafr1vf3>>;
    /**
     * Start the process of destroying a fungible asset class.
     *
     * `start_destroy` is the first in a series of extrinsics that should be called, to allow
     * destruction of an asset class.
     *
     * The origin must conform to `ForceOrigin` or must be `Signed` by the asset's `owner`.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * an account contains holds or freezes in place.
     */
    start_destroy: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Destroy all accounts associated with a given asset.
     *
     * `destroy_accounts` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all accounts. It will destroy `RemoveItemsLimit` accounts at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedAccounts` event.
     */
    destroy_accounts: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Destroy all approvals associated with a given asset up to the max (T::RemoveItemsLimit).
     *
     * `destroy_approvals` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state.
     *
     * Due to weight restrictions, this function may need to be called multiple times to fully
     * destroy all approvals. It will destroy `RemoveItemsLimit` approvals at a time.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each call emits the `Event::DestroyedApprovals` event.
     */
    destroy_approvals: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Complete destroying asset and unreserve currency.
     *
     * `finish_destroy` should only be called after `start_destroy` has been called, and the
     * asset is in a `Destroying` state. All accounts or approvals should be destroyed before
     * hand.
     *
     * - `id`: The identifier of the asset to be destroyed. This must identify an existing
     * asset.
     *
     * Each successful call emits the `Event::Destroyed` event.
     */
    finish_destroy: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Mint assets of a particular class.
     *
     * The origin must be Signed and the sender must be the Issuer of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount minted.
     * - `beneficiary`: The account to be credited with the minted assets.
     * - `amount`: The amount of the asset to be minted.
     *
     * Emits `Issued` event when successful.
     *
     * Weight: `O(1)`
     * Modes: Pre-existing balance of `beneficiary`; Account pre-existence of `beneficiary`.
     */
    mint: TxDescriptor<Anonymize<Icfoe9q8d4vs8f>>;
    /**
     * Reduce the balance of `who` by as much as possible up to `amount` assets of `id`.
     *
     * Origin must be Signed and the sender should be the Manager of the asset `id`.
     *
     * Bails with `NoAccount` if the `who` is already dead.
     *
     * - `id`: The identifier of the asset to have some amount burned.
     * - `who`: The account to be debited from.
     * - `amount`: The maximum amount by which `who`'s balance should be reduced.
     *
     * Emits `Burned` with the actual amount burned. If this takes the balance to below the
     * minimum for the asset, then the amount burned is increased to take it to zero.
     *
     * Weight: `O(1)`
     * Modes: Post-existence of `who`; Pre & post Zombie-status of `who`.
     */
    burn: TxDescriptor<Anonymize<Ibrfmvjrg4trnb>>;
    /**
     * Move some assets from the sender account to another.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    transfer: TxDescriptor<Anonymize<Iedih7t34maii9>>;
    /**
     * Move some assets from the sender account to another, keeping the sender account alive.
     *
     * Origin must be Signed.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `target`: The account to be credited.
     * - `amount`: The amount by which the sender's balance of assets should be reduced and
     * `target`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the sender balance above zero but below
     * the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
     * `target`.
     */
    transfer_keep_alive: TxDescriptor<Anonymize<Iedih7t34maii9>>;
    /**
     * Move some assets from one account to another.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to have some amount transferred.
     * - `source`: The account to be debited.
     * - `dest`: The account to be credited.
     * - `amount`: The amount by which the `source`'s balance of assets should be reduced and
     * `dest`'s balance increased. The amount actually transferred may be slightly greater in
     * the case that the transfer would otherwise take the `source` balance above zero but
     * below the minimum balance. Must be greater than zero.
     *
     * Emits `Transferred` with the actual amount transferred. If this takes the source balance
     * to below the minimum for the asset, then the amount transferred is increased to take it
     * to zero.
     *
     * Weight: `O(1)`
     * Modes: Pre-existence of `dest`; Post-existence of `source`; Account pre-existence of
     * `dest`.
     */
    force_transfer: TxDescriptor<Anonymize<I4e902qbfel1f1>>;
    /**
     * Disallow further unprivileged transfers of an asset `id` from an account `who`. `who`
     * must already exist as an entry in `Account`s of the asset. If you want to freeze an
     * account that does not have an entry, use `touch_other` first.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    freeze: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
    /**
     * Allow unprivileged transfers to and from an account again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `who`: The account to be unfrozen.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    thaw: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
    /**
     * Disallow further unprivileged transfers for the asset class.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     *
     * Emits `Frozen`.
     *
     * Weight: `O(1)`
     */
    freeze_asset: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Allow unprivileged transfers for the asset again.
     *
     * Origin must be Signed and the sender should be the Admin of the asset `id`.
     *
     * - `id`: The identifier of the asset to be thawed.
     *
     * Emits `Thawed`.
     *
     * Weight: `O(1)`
     */
    thaw_asset: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Change the Owner of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     *
     * Emits `OwnerChanged`.
     *
     * Weight: `O(1)`
     */
    transfer_ownership: TxDescriptor<Anonymize<I1t8vq6a06ohhu>>;
    /**
     * Change the Issuer, Admin and Freezer of an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * - `id`: The identifier of the asset to be frozen.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     *
     * Emits `TeamChanged`.
     *
     * Weight: `O(1)`
     */
    set_team: TxDescriptor<Anonymize<Icvt3pdunbinm7>>;
    /**
     * Set the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Funds of sender are reserved according to the formula:
     * `MetadataDepositBase + MetadataDepositPerByte * (name.len + symbol.len)` taking into
     * account any already reserved funds.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(1)`
     */
    set_metadata: TxDescriptor<Anonymize<I9ui3n41balr2q>>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be Signed and the sender should be the Owner of the asset `id`.
     *
     * Any deposit is freed for the asset owner.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    clear_metadata: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Force the metadata for an asset to some value.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is left alone.
     *
     * - `id`: The identifier of the asset to update.
     * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
     * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
     * - `decimals`: The number of decimals this asset uses to represent one unit.
     *
     * Emits `MetadataSet`.
     *
     * Weight: `O(N + S)` where N and S are the length of the name and symbol respectively.
     */
    force_set_metadata: TxDescriptor<Anonymize<I89sl7btgl24g2>>;
    /**
     * Clear the metadata for an asset.
     *
     * Origin must be ForceOrigin.
     *
     * Any deposit is returned.
     *
     * - `id`: The identifier of the asset to clear.
     *
     * Emits `MetadataCleared`.
     *
     * Weight: `O(1)`
     */
    force_clear_metadata: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Alter the attributes of a given asset.
     *
     * Origin must be `ForceOrigin`.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The new Owner of this asset.
     * - `issuer`: The new Issuer of this asset.
     * - `admin`: The new Admin of this asset.
     * - `freezer`: The new Freezer of this asset.
     * - `min_balance`: The minimum balance of this new asset that any single account must
     * have. If an account's balance is reduced below this, then it collapses to zero.
     * - `is_sufficient`: Whether a non-zero balance of this asset is deposit of sufficient
     * value to account for the state bloat associated with its balance storage. If set to
     * `true`, then non-zero balances may be stored without a `consumer` reference (and thus
     * an ED in the Balances pallet or whatever else is used to control user-account state
     * growth).
     * - `is_frozen`: Whether this asset class is frozen except for permissioned/admin
     * instructions.
     *
     * Emits `AssetStatusChanged` with the identity of the asset.
     *
     * Weight: `O(1)`
     */
    force_asset_status: TxDescriptor<Anonymize<I3u6g26k9kn96u>>;
    /**
     * Approve an amount of asset for transfer by a delegated third-party account.
     *
     * Origin must be Signed.
     *
     * Ensures that `ApprovalDeposit` worth of `Currency` is reserved from signing account
     * for the purpose of holding the approval. If some non-zero amount of assets is already
     * approved from signing account to `delegate`, then it is topped up or unreserved to
     * meet the right value.
     *
     * NOTE: The signing account does not need to own `amount` of assets at the point of
     * making this call.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account to delegate permission to transfer asset.
     * - `amount`: The amount of asset that may be transferred by `delegate`. If there is
     * already an approval in place, then this acts additively.
     *
     * Emits `ApprovedTransfer` on success.
     *
     * Weight: `O(1)`
     */
    approve_transfer: TxDescriptor<Anonymize<If1invp94rsjms>>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be Signed and there must be an approval in place between signer and
     * `delegate`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    cancel_approval: TxDescriptor<Anonymize<Ie5nc19gtiv5sv>>;
    /**
     * Cancel all of some asset approved for delegated transfer by a third-party account.
     *
     * Origin must be either ForceOrigin or Signed origin with the signer being the Admin
     * account of the asset `id`.
     *
     * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
     *
     * - `id`: The identifier of the asset.
     * - `delegate`: The account delegated permission to transfer asset.
     *
     * Emits `ApprovalCancelled` on success.
     *
     * Weight: `O(1)`
     */
    force_cancel_approval: TxDescriptor<Anonymize<Iald3dgvt1hjkb>>;
    /**
     * Transfer some asset balance from a previously delegated account to some third-party
     * account.
     *
     * Origin must be Signed and there must be an approval in place by the `owner` to the
     * signer.
     *
     * If the entire amount approved for transfer is transferred, then any deposit previously
     * reserved by `approve_transfer` is unreserved.
     *
     * - `id`: The identifier of the asset.
     * - `owner`: The account which previously approved for a transfer of at least `amount` and
     * from which the asset balance will be withdrawn.
     * - `destination`: The account to which the asset balance of `amount` will be transferred.
     * - `amount`: The amount of assets to transfer.
     *
     * Emits `TransferredApproved` on success.
     *
     * Weight: `O(1)`
     */
    transfer_approved: TxDescriptor<Anonymize<Iurrhahet4gno>>;
    /**
     * Create an asset account for non-provider assets.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created.
     *
     * Emits `Touched` event when successful.
     */
    touch: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
    /**
     * Return the deposit (if any) of an asset account or a consumer reference (if any) of an
     * account.
     *
     * The origin must be Signed.
     *
     * - `id`: The identifier of the asset for which the caller would like the deposit
     * refunded.
     * - `allow_burn`: If `true` then assets may be destroyed in order to complete the refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    refund: TxDescriptor<Anonymize<I5tamv2nk8bj8o>>;
    /**
     * Sets the minimum balance of an asset.
     *
     * Only works if there aren't any accounts that are holding the asset or if
     * the new value of `min_balance` is less than the old one.
     *
     * Origin must be Signed and the sender has to be the Owner of the
     * asset `id`.
     *
     * - `id`: The identifier of the asset.
     * - `min_balance`: The new value of `min_balance`.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    set_min_balance: TxDescriptor<Anonymize<I8apq8e7c7qcpp>>;
    /**
     * Create an asset account for `who`.
     *
     * A deposit will be taken from the signer account.
     *
     * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
     * to be taken.
     * - `id`: The identifier of the asset for the account to be created, the asset status must
     * be live.
     * - `who`: The account to be created.
     *
     * Emits `Touched` event when successful.
     */
    touch_other: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
    /**
     * Return the deposit (if any) of a target asset account. Useful if you are the depositor.
     *
     * The origin must be Signed and either the account owner, depositor, or asset `Admin`. In
     * order to burn a non-zero balance of the asset, the caller must be the account and should
     * use `refund`.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `who`: The account to refund.
     *
     * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
     * the asset account contains holds or freezes in place.
     *
     * Emits `Refunded` event when successful.
     */
    refund_other: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
    /**
     * Disallow further unprivileged transfers of an asset `id` to and from an account `who`.
     *
     * Origin must be Signed and the sender should be the Freezer of the asset `id`.
     *
     * - `id`: The identifier of the account's asset.
     * - `who`: The account to be unblocked.
     *
     * Emits `Blocked`.
     *
     * Weight: `O(1)`
     */
    block: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
    /**
     * Transfer the entire transferable balance from the caller asset account.
     *
     * NOTE: This function only attempts to transfer _transferable_ balances. This means that
     * any held, frozen, or minimum balance (when `keep_alive` is `true`), will not be
     * transferred by this function. To ensure that this function results in a killed account,
     * you might need to prepare the account by removing any reference counters, storage
     * deposits, etc...
     *
     * The dispatch origin of this call must be Signed.
     *
     * - `id`: The identifier of the asset for the account holding a deposit.
     * - `dest`: The recipient of the transfer.
     * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
     * of the funds the asset account has, causing the sender asset account to be killed
     * (false), or transfer everything except at least the minimum balance, which will
     * guarantee to keep the sender asset account alive (true).
     */
    transfer_all: TxDescriptor<Anonymize<Id1e31ij0c35fv>>;
    /**
     * Sets the trusted reserve information of an asset.
     *
     * Origin must be the Owner of the asset `id`. The origin must conform to the configured
     * `CreateOrigin` or be the signed `owner` configured during asset creation.
     *
     * - `id`: The identifier of the asset.
     * - `reserves`: The full list of trusted reserves information.
     *
     * Emits `AssetMinBalanceChanged` event when successful.
     */
    set_reserves: TxDescriptor<Anonymize<Ibm7u0qulpnrs9>>;
  };
  Vesting: {
    /**
     * Unlock any vested funds of the sender account.
     *
     * The dispatch origin for this call must be _Signed_ and the sender must have funds still
     * locked under this pallet.
     *
     * Emits either `VestingCompleted` or `VestingUpdated`.
     *
     * ## Complexity
     * - `O(1)`.
     */
    vest: TxDescriptor<undefined>;
    /**
     * Unlock any vested funds of a `target` account.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `target`: The account whose vested funds should be unlocked. Must have funds still
     * locked under this pallet.
     *
     * Emits either `VestingCompleted` or `VestingUpdated`.
     *
     * ## Complexity
     * - `O(1)`.
     */
    vest_other: TxDescriptor<Anonymize<Id9uqtigc0il3v>>;
    /**
     * Create a vested transfer.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `target`: The account receiving the vested funds.
     * - `schedule`: The vesting schedule attached to the transfer.
     *
     * Emits `VestingCreated`.
     *
     * NOTE: This will unlock all schedules through the current block.
     *
     * ## Complexity
     * - `O(1)`.
     */
    vested_transfer: TxDescriptor<Anonymize<Iaa2o6cgjdpdn5>>;
    /**
     * Force a vested transfer.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * - `source`: The account whose funds should be transferred.
     * - `target`: The account that should be transferred the vested funds.
     * - `schedule`: The vesting schedule attached to the transfer.
     *
     * Emits `VestingCreated`.
     *
     * NOTE: This will unlock all schedules through the current block.
     *
     * ## Complexity
     * - `O(1)`.
     */
    force_vested_transfer: TxDescriptor<Anonymize<Iam6hrl7ptd85l>>;
    /**
     * Merge two vesting schedules together, creating a new vesting schedule that unlocks over
     * the highest possible start and end blocks. If both schedules have already started the
     * current block will be used as the schedule start; with the caveat that if one schedule
     * is finished by the current block, the other will be treated as the new merged schedule,
     * unmodified.
     *
     * NOTE: If `schedule1_index == schedule2_index` this is a no-op.
     * NOTE: This will unlock all schedules through the current block prior to merging.
     * NOTE: If both schedules have ended by the current block, no new schedule will be created
     * and both will be removed.
     *
     * Merged schedule attributes:
     * - `starting_block`: `MAX(schedule1.starting_block, scheduled2.starting_block,
     * current_block)`.
     * - `ending_block`: `MAX(schedule1.ending_block, schedule2.ending_block)`.
     * - `locked`: `schedule1.locked_at(current_block) + schedule2.locked_at(current_block)`.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `schedule1_index`: index of the first schedule to merge.
     * - `schedule2_index`: index of the second schedule to merge.
     */
    merge_schedules: TxDescriptor<Anonymize<Ict9ivhr2c5hv0>>;
    /**
     * Force remove a vesting schedule
     *
     * The dispatch origin for this call must be _Root_.
     *
     * - `target`: An account that has a vesting schedule
     * - `schedule_index`: The vesting schedule index that should be removed
     */
    force_remove_vesting_schedule: TxDescriptor<Anonymize<I8t4vv03357lk9>>;
  };
  Referenda: {
    /**
     * Propose a referendum on a privileged action.
     *
     * - `origin`: must be `SubmitOrigin` and the account must have `SubmissionDeposit` funds
     * available.
     * - `proposal_origin`: The origin from which the proposal should be executed.
     * - `proposal`: The proposal.
     * - `enactment_moment`: The moment that the proposal should be enacted.
     *
     * Emits `Submitted`.
     */
    submit: TxDescriptor<Anonymize<Ifc6beta7g87k>>;
    /**
     * Post the Decision Deposit for a referendum.
     *
     * - `origin`: must be `Signed` and the account must have funds available for the
     * referendum's track's Decision Deposit.
     * - `index`: The index of the submitted referendum whose Decision Deposit is yet to be
     * posted.
     *
     * Emits `DecisionDepositPlaced`.
     */
    place_decision_deposit: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Refund the Decision Deposit for a closed referendum back to the depositor.
     *
     * - `origin`: must be `Signed` or `Root`.
     * - `index`: The index of a closed referendum whose Decision Deposit has not yet been
     * refunded.
     *
     * Emits `DecisionDepositRefunded`.
     */
    refund_decision_deposit: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Cancel an ongoing referendum.
     *
     * - `origin`: must be the `CancelOrigin`.
     * - `index`: The index of the referendum to be cancelled.
     *
     * Emits `Cancelled`.
     */
    cancel: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Cancel an ongoing referendum and slash the deposits.
     *
     * - `origin`: must be the `KillOrigin`.
     * - `index`: The index of the referendum to be cancelled.
     *
     * Emits `Killed` and `DepositSlashed`.
     */
    kill: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Advance a referendum onto its next logical state. Only used internally.
     *
     * - `origin`: must be `Root`.
     * - `index`: the referendum to be advanced.
     */
    nudge_referendum: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Advance a track onto its next logical state. Only used internally.
     *
     * - `origin`: must be `Root`.
     * - `track`: the track to be advanced.
     *
     * Action item for when there is now one fewer referendum in the deciding phase and the
     * `DecidingCount` is not yet updated. This means that we should either:
     * - begin deciding another referendum (and leave `DecidingCount` alone); or
     * - decrement `DecidingCount`.
     */
    one_fewer_deciding: TxDescriptor<Anonymize<Icbio0e1f0034b>>;
    /**
     * Refund the Submission Deposit for a closed referendum back to the depositor.
     *
     * - `origin`: must be `Signed` or `Root`.
     * - `index`: The index of a closed referendum whose Submission Deposit has not yet been
     * refunded.
     *
     * Emits `SubmissionDepositRefunded`.
     */
    refund_submission_deposit: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * Set or clear metadata of a referendum.
     *
     * Parameters:
     * - `origin`: Must be `Signed` by a creator of a referendum or by anyone to clear a
     * metadata of a finished referendum.
     * - `index`:  The index of a referendum to set or clear metadata for.
     * - `maybe_hash`: The hash of an on-chain stored preimage. `None` to clear a metadata.
     */
    set_metadata: TxDescriptor<Anonymize<I8c0vkqjjipnuj>>;
  };
  ConvictionVoting: {
    /**
     * Vote in a poll. If `vote.is_aye()`, the vote is to enact the proposal;
     * otherwise it is a vote to keep the status quo.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `poll_index`: The index of the poll to vote for.
     * - `vote`: The vote configuration.
     *
     * Weight: `O(R)` where R is the number of polls the voter has voted on.
     */
    vote: TxDescriptor<Anonymize<Idnsr2pndm36h0>>;
    /**
     * Delegate the voting power (with some given conviction) of the sending account for a
     * particular class of polls.
     *
     * The balance delegated is locked for as long as it's delegated, and thereafter for the
     * time appropriate for the conviction's lock period.
     *
     * The dispatch origin of this call must be _Signed_, and the signing account must either:
     * - be delegating already; or
     * - have no voting activity (if there is, then it will need to be removed through
     * `remove_vote`).
     *
     * - `to`: The account whose voting the `target` account's voting power will follow.
     * - `class`: The class of polls to delegate. To delegate multiple classes, multiple calls
     * to this function are required.
     * - `conviction`: The conviction that will be attached to the delegated votes. When the
     * account is undelegated, the funds will be locked for the corresponding period.
     * - `balance`: The amount of the account's balance to be used in delegating. This must not
     * be more than the account's current balance.
     *
     * Emits `Delegated`.
     *
     * Weight: `O(R)` where R is the number of polls the voter delegating to has
     * voted on. Weight is initially charged as if maximum votes, but is refunded later.
     */
    delegate: TxDescriptor<Anonymize<Ia1pvdcbhuqf8m>>;
    /**
     * Undelegate the voting power of the sending account for a particular class of polls.
     *
     * Tokens may be unlocked following once an amount of time consistent with the lock period
     * of the conviction with which the delegation was issued has passed.
     *
     * The dispatch origin of this call must be _Signed_ and the signing account must be
     * currently delegating.
     *
     * - `class`: The class of polls to remove the delegation from.
     *
     * Emits `Undelegated`.
     *
     * Weight: `O(R)` where R is the number of polls the voter delegating to has
     * voted on. Weight is initially charged as if maximum votes, but is refunded later.
     */
    undelegate: TxDescriptor<Anonymize<I8steo882k7qns>>;
    /**
     * Remove the lock caused by prior voting/delegating which has expired within a particular
     * class.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `class`: The class of polls to unlock.
     * - `target`: The account to remove the lock on.
     *
     * Weight: `O(R)` with R number of vote of target.
     */
    unlock: TxDescriptor<Anonymize<I4pa4q37gj6fua>>;
    /**
     * Remove a vote for a poll.
     *
     * If:
     * - the poll was cancelled, or
     * - the poll is ongoing, or
     * - the poll has ended such that
     * - the vote of the account was in opposition to the result; or
     * - there was no conviction to the account's vote; or
     * - the account made a split vote
     * ...then the vote is removed cleanly and a following call to `unlock` may result in more
     * funds being available.
     *
     * If, however, the poll has ended and:
     * - it finished corresponding to the vote of the account, and
     * - the account made a standard vote with conviction, and
     * - the lock period of the conviction is not over
     * ...then the lock will be aggregated into the overall account's lock, which may involve
     * *overlocking* (where the two locks are combined into a single lock that is the maximum
     * of both the amount locked and the time is it locked for).
     *
     * The dispatch origin of this call must be _Signed_, and the signer must have a vote
     * registered for poll `index`.
     *
     * - `index`: The index of poll of the vote to be removed.
     * - `class`: Optional parameter, if given it indicates the class of the poll. For polls
     * which have finished or are cancelled, this must be `Some`.
     *
     * Weight: `O(R + log R)` where R is the number of polls that `target` has voted on.
     * Weight is calculated for the maximum number of vote.
     */
    remove_vote: TxDescriptor<Anonymize<I5f178ab6b89t3>>;
    /**
     * Remove a vote for a poll.
     *
     * If the `target` is equal to the signer, then this function is exactly equivalent to
     * `remove_vote`. If not equal to the signer, then the vote must have expired,
     * either because the poll was cancelled, because the voter lost the poll or
     * because the conviction period is over.
     *
     * The dispatch origin of this call must be _Signed_.
     *
     * - `target`: The account of the vote to be removed; this account must have voted for poll
     * `index`.
     * - `index`: The index of poll of the vote to be removed.
     * - `class`: The class of the poll.
     *
     * Weight: `O(R + log R)` where R is the number of polls that `target` has voted on.
     * Weight is calculated for the maximum number of vote.
     */
    remove_other_vote: TxDescriptor<Anonymize<I4nakhtbsk3c5s>>;
  };
  Preimage: {
    /**
     * Register a preimage on-chain.
     *
     * If the preimage was previously requested, no fees or deposits are taken for providing
     * the preimage. Otherwise, a deposit is taken proportional to the size of the preimage.
     */
    note_preimage: TxDescriptor<Anonymize<I82nfqfkd48n10>>;
    /**
     * Clear an unrequested preimage from the runtime storage.
     *
     * If `len` is provided, then it will be a much cheaper operation.
     *
     * - `hash`: The hash of the preimage to be removed from the store.
     * - `len`: The length of the preimage of `hash`.
     */
    unnote_preimage: TxDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * Request a preimage be uploaded to the chain without paying any fees or deposits.
     *
     * If the preimage requests has already been provided on-chain, we unreserve any deposit
     * a user may have paid, and take the control of the preimage out of their hands.
     */
    request_preimage: TxDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * Clear a previously made request for a preimage.
     *
     * NOTE: THIS MUST NOT BE CALLED ON `hash` MORE TIMES THAN `request_preimage`.
     */
    unrequest_preimage: TxDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * Ensure that the bulk of pre-images is upgraded.
     *
     * The caller pays no fee if at least 90% of pre-images were successfully updated.
     */
    ensure_updated: TxDescriptor<Anonymize<I3o5j3bli1pd8e>>;
  };
  Scheduler: {
    /**
     * Anonymously schedule a task.
     */
    schedule: TxDescriptor<Anonymize<Iet0dtt3q9k4bk>>;
    /**
     * Cancel a scheduled task (named or anonymous), by providing the block it is scheduled for
     * execution in, as well as the index of the task in that block's agenda.
     *
     * In the case of a named task, it will remove it from the lookup table as well.
     */
    cancel: TxDescriptor<Anonymize<I5n4sebgkfr760>>;
    /**
     * Schedule a named task.
     */
    schedule_named: TxDescriptor<Anonymize<I2jhl9koipl72b>>;
    /**
     * Cancel a named scheduled task.
     */
    cancel_named: TxDescriptor<Anonymize<Ifs1i5fk9cqvr6>>;
    /**
     * Anonymously schedule a task after a delay.
     */
    schedule_after: TxDescriptor<Anonymize<I6tndkavufkmbv>>;
    /**
     * Schedule a named task after a delay.
     */
    schedule_named_after: TxDescriptor<Anonymize<Icph8qjashf315>>;
    /**
     * Set a retry configuration for a task so that, in case its scheduled run fails, it will
     * be retried after `period` blocks, for a total amount of `retries` retries or until it
     * succeeds.
     *
     * Tasks which need to be scheduled for a retry are still subject to weight metering and
     * agenda space, same as a regular task. If a periodic task fails, it will be scheduled
     * normally while the task is retrying.
     *
     * Tasks scheduled as a result of a retry for a periodic task are unnamed, non-periodic
     * clones of the original task. Their retry configuration will be derived from the
     * original task's configuration, but will have a lower value for `remaining` than the
     * original `total_retries`.
     *
     * This call **cannot** be used to set a retry configuration for a named task.
     */
    set_retry: TxDescriptor<Anonymize<Ieg3fd8p4pkt10>>;
    /**
     * Set a retry configuration for a named task so that, in case its scheduled run fails, it
     * will be retried after `period` blocks, for a total amount of `retries` retries or until
     * it succeeds.
     *
     * Tasks which need to be scheduled for a retry are still subject to weight metering and
     * agenda space, same as a regular task. If a periodic task fails, it will be scheduled
     * normally while the task is retrying.
     *
     * Tasks scheduled as a result of a retry for a periodic task are unnamed, non-periodic
     * clones of the original task. Their retry configuration will be derived from the
     * original task's configuration, but will have a lower value for `remaining` than the
     * original `total_retries`.
     *
     * This is the only way to set a retry configuration for a named task.
     */
    set_retry_named: TxDescriptor<Anonymize<I8kg5ll427kfqq>>;
    /**
     * Removes the retry configuration of a task.
     */
    cancel_retry: TxDescriptor<Anonymize<I467333262q1l9>>;
    /**
     * Cancel the retry configuration of a named task.
     */
    cancel_retry_named: TxDescriptor<Anonymize<Ifs1i5fk9cqvr6>>;
  };
  Utility: {
    /**
     * Send a batch of dispatch calls.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     *
     * This will return `Ok` in all circumstances. To determine the success of the batch, an
     * event is deposited. If a call failed and the batch was interrupted, then the
     * `BatchInterrupted` event is deposited, along with the number of successful calls made
     * and the error of the failed call. If all were successful, then the `BatchCompleted`
     * event is deposited.
     */
    batch: TxDescriptor<Anonymize<I7v6q4eo5bpqja>>;
    /**
     * Send a call through an indexed pseudonym of the sender.
     *
     * Filter from origin are passed along. The call will be dispatched with an origin which
     * use the same filter as the origin of this call.
     *
     * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
     * because you expect `proxy` to have been used prior in the call stack and you do not want
     * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
     * in the Multisig pallet instead.
     *
     * NOTE: Prior to version *12, this was called `as_limited_sub`.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    as_derivative: TxDescriptor<Anonymize<I6ftm1lq7baqj4>>;
    /**
     * Send a batch of dispatch calls and atomically execute them.
     * The whole transaction will rollback and fail if any of the calls failed.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatched without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    batch_all: TxDescriptor<Anonymize<I7v6q4eo5bpqja>>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * The dispatch origin for this call must be _Root_.
     *
     * ## Complexity
     * - O(1).
     */
    dispatch_as: TxDescriptor<Anonymize<I5ua4t7rcge9ca>>;
    /**
     * Send a batch of dispatch calls.
     * Unlike `batch`, it allows errors and won't interrupt.
     *
     * May be called from any origin except `None`.
     *
     * - `calls`: The calls to be dispatched from the same origin. The number of call must not
     * exceed the constant: `batched_calls_limit` (available in constant metadata).
     *
     * If origin is root then the calls are dispatch without checking origin filter. (This
     * includes bypassing `frame_system::Config::BaseCallFilter`).
     *
     * ## Complexity
     * - O(C) where C is the number of calls to be batched.
     */
    force_batch: TxDescriptor<Anonymize<I7v6q4eo5bpqja>>;
    /**
     * Dispatch a function call with a specified weight.
     *
     * This function does not check the weight of the call, and instead allows the
     * Root origin to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    with_weight: TxDescriptor<Anonymize<I1q7iisvnsn9jn>>;
    /**
     * Dispatch a fallback call in the event the main call fails to execute.
     * May be called from any origin except `None`.
     *
     * This function first attempts to dispatch the `main` call.
     * If the `main` call fails, the `fallback` is attemted.
     * if the fallback is successfully dispatched, the weights of both calls
     * are accumulated and an event containing the main call error is deposited.
     *
     * In the event of a fallback failure the whole call fails
     * with the weights returned.
     *
     * - `main`: The main call to be dispatched. This is the primary action to execute.
     * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
     *
     * ## Dispatch Logic
     * - If the origin is `root`, both the main and fallback calls are executed without
     * applying any origin filters.
     * - If the origin is not `root`, the origin filter is applied to both the `main` and
     * `fallback` calls.
     *
     * ## Use Case
     * - Some use cases might involve submitting a `batch` type call in either main, fallback
     * or both.
     */
    if_else: TxDescriptor<Anonymize<I2cr2dkgo2tr4e>>;
    /**
     * Dispatches a function call with a provided origin.
     *
     * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
     *
     * The dispatch origin for this call must be _Root_.
     */
    dispatch_as_fallible: TxDescriptor<Anonymize<I5ua4t7rcge9ca>>;
  };
  Proxy: {
    /**
     * Dispatch the given `call` from an account that the sender is authorised for through
     * `add_proxy`.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    proxy: TxDescriptor<Anonymize<I7vo2kfsore692>>;
    /**
     * Register a proxy account for the sender that is able to make calls on its behalf.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to make a proxy.
     * - `proxy_type`: The permissions allowed for this proxy account.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     */
    add_proxy: TxDescriptor<Anonymize<I3lj33btcqlb1i>>;
    /**
     * Unregister a proxy account for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `proxy`: The account that the `caller` would like to remove as a proxy.
     * - `proxy_type`: The permissions currently enabled for the removed proxy account.
     */
    remove_proxy: TxDescriptor<Anonymize<I3lj33btcqlb1i>>;
    /**
     * Unregister all proxy accounts for the sender.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * WARNING: This may be called on accounts created by `create_pure`, however if done, then
     * the unreserved fees will be inaccessible. **All access to this account will be lost.**
     */
    remove_proxies: TxDescriptor<undefined>;
    /**
     * Spawn a fresh new account that is guaranteed to be otherwise inaccessible, and
     * initialize it with a proxy of `proxy_type` for `origin` sender.
     *
     * Requires a `Signed` origin.
     *
     * - `proxy_type`: The type of the proxy that the sender will be registered as over the
     * new account. This will almost always be the most permissive `ProxyType` possible to
     * allow for maximum flexibility.
     * - `index`: A disambiguation index, in case this is called multiple times in the same
     * transaction (e.g. with `utility::batch`). Unless you're using `batch` you probably just
     * want to use `0`.
     * - `delay`: The announcement period required of the initial proxy. Will generally be
     * zero.
     *
     * Fails with `Duplicate` if this has already been called in this transaction, from the
     * same sender, with the same parameters.
     *
     * Fails if there are insufficient funds to pay for deposit.
     */
    create_pure: TxDescriptor<Anonymize<I707m7edh0jft8>>;
    /**
     * Removes a previously spawned pure proxy.
     *
     * WARNING: **All access to this account will be lost.** Any funds held in it will be
     * inaccessible.
     *
     * Requires a `Signed` origin, and the sender account must have been created by a call to
     * `create_pure` with corresponding parameters.
     *
     * - `spawner`: The account that originally called `create_pure` to create this account.
     * - `index`: The disambiguation index originally passed to `create_pure`. Probably `0`.
     * - `proxy_type`: The proxy type originally passed to `create_pure`.
     * - `height`: The height of the chain when the call to `create_pure` was processed.
     * - `ext_index`: The extrinsic index in which the call to `create_pure` was processed.
     *
     * Fails with `NoPermission` in case the caller is not a previously created pure
     * account whose `create_pure` call has corresponding parameters.
     */
    kill_pure: TxDescriptor<Anonymize<I2j5sqe1l974kn>>;
    /**
     * Publish the hash of a proxy-call that will be made in the future.
     *
     * This must be called some number of blocks before the corresponding `proxy` is attempted
     * if the delay associated with the proxy relationship is greater than zero.
     *
     * No more than `MaxPending` announcements may be made at any one time.
     *
     * This will take a deposit of `AnnouncementDepositFactor` as well as
     * `AnnouncementDepositBase` if there are no other pending announcements.
     *
     * The dispatch origin for this call must be _Signed_ and a proxy of `real`.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    announce: TxDescriptor<Anonymize<I2eb501t8s6hsq>>;
    /**
     * Remove a given announcement.
     *
     * May be called by a proxy account to remove a call they previously announced and return
     * the deposit.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `call_hash`: The hash of the call to be made by the `real` account.
     */
    remove_announcement: TxDescriptor<Anonymize<I2eb501t8s6hsq>>;
    /**
     * Remove the given announcement of a delegate.
     *
     * May be called by a target (proxied) account to remove a call that one of their delegates
     * (`delegate`) has announced they want to execute. The deposit is returned.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `delegate`: The account that previously announced the call.
     * - `call_hash`: The hash of the call to be made.
     */
    reject_announcement: TxDescriptor<Anonymize<Ianmuoljk2sk1u>>;
    /**
     * Dispatch the given `call` from an account that the sender is authorized for through
     * `add_proxy`.
     *
     * Removes any corresponding announcement(s).
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * Parameters:
     * - `real`: The account that the proxy will make a call on behalf of.
     * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
     * - `call`: The call to be made by the `real` account.
     */
    proxy_announced: TxDescriptor<Anonymize<I6232pg7njm7nt>>;
    /**
     * Poke / Adjust deposits made for proxies and announcements based on current values.
     * This can be used by accounts to possibly lower their locked amount.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * Emits `DepositPoked` if successful.
     */
    poke_deposit: TxDescriptor<undefined>;
  };
  Multisig: {
    /**
     * Immediately dispatch a multi-signature call using a single approval from the caller.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multi-signature, but do not participate in the approval process.
     * - `call`: The call to be executed.
     *
     * Result is equivalent to the dispatched result.
     *
     * ## Complexity
     * O(Z + C) where Z is the length of the call and C its execution weight.
     */
    as_multi_threshold_1: TxDescriptor<Anonymize<Ib4dcamu44h2f8>>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **If the approval threshold is met (including the sender's approval), this will
     * immediately execute the call.** This is the only way to execute a multisig call -
     * `approve_as_multi` will never trigger execution.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call`: The call to be executed.
     *
     * NOTE: For intermediate approvals (not the final approval), you should generally use
     * `approve_as_multi` instead, since it only requires a hash of the call and is more
     * efficient.
     *
     * Result is equivalent to the dispatched result if `threshold` is exactly `1`. Otherwise
     * on success, result is `Ok` and the result from the interior call, if it was executed,
     * may be found in the deposited `MultisigExecuted` event.
     *
     * ## Complexity
     * - `O(S + Z + Call)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One call encode & hash, both of complexity `O(Z)` where `Z` is tx-len.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - The weight of the `call`.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    as_multi: TxDescriptor<Anonymize<Iajkocjedluuc3>>;
    /**
     * Register approval for a dispatch to be made from a deterministic composite account if
     * approved by a total of `threshold - 1` of `other_signatories`.
     *
     * **This function will NEVER execute the call, even if the approval threshold is
     * reached.** It only registers approval. To actually execute the call, `as_multi` must
     * be called with the full call data by any of the signatories.
     *
     * This function is more efficient than `as_multi` for intermediate approvals since it
     * only requires the call hash, not the full call data.
     *
     * Payment: `DepositBase` will be reserved if this is the first approval, plus
     * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
     * is cancelled.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
     * not the first approval, then it must be `Some`, with the timepoint (block number and
     * transaction index) of the first approval transaction.
     * - `call_hash`: The hash of the call to be executed.
     *
     * NOTE: To execute the call after approvals are gathered, any signatory must call
     * `as_multi` with the full call data. This function cannot execute the call.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - Up to one binary search and insert (`O(logS + S)`).
     * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
     * - One event.
     * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
     * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
     */
    approve_as_multi: TxDescriptor<Anonymize<Ideaemvoneh309>>;
    /**
     * Cancel a pre-existing, on-going multisig transaction. Any deposit reserved previously
     * for this operation will be unreserved on success.
     *
     * The dispatch origin for this call must be _Signed_.
     *
     * - `threshold`: The total number of approvals for this dispatch before it is executed.
     * - `other_signatories`: The accounts (other than the sender) who can approve this
     * dispatch. May not be empty.
     * - `timepoint`: The timepoint (block number and transaction index) of the first approval
     * transaction for this dispatch.
     * - `call_hash`: The hash of the call to be executed.
     *
     * ## Complexity
     * - `O(S)`.
     * - Up to one balance-reserve or unreserve operation.
     * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
     * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
     * - One encode & hash, both of complexity `O(S)`.
     * - One event.
     * - I/O: 1 read `O(S)`, one remove.
     * - Storage: removes one item.
     */
    cancel_as_multi: TxDescriptor<Anonymize<I3d9o9d7epp66v>>;
    /**
     * Poke the deposit reserved for an existing multisig operation.
     *
     * The dispatch origin for this call must be _Signed_ and must be the original depositor of
     * the multisig operation.
     *
     * The transaction fee is waived if the deposit amount has changed.
     *
     * - `threshold`: The total number of approvals needed for this multisig.
     * - `other_signatories`: The accounts (other than the sender) who are part of the
     * multisig.
     * - `call_hash`: The hash of the call this deposit is reserved for.
     *
     * Emits `DepositPoked` if successful.
     */
    poke_deposit: TxDescriptor<Anonymize<I6lqh1vgb4mcja>>;
  };
  Migrations: {
    /**
     * Allows root to set a cursor to forcefully start, stop or forward the migration process.
     *
     * Should normally not be needed and is only in place as emergency measure. Note that
     * restarting the migration process in this manner will not call the
     * [`MigrationStatusHandler::started`] hook or emit an `UpgradeStarted` event.
     */
    force_set_cursor: TxDescriptor<Anonymize<Ibou4u1engb441>>;
    /**
     * Allows root to set an active cursor to forcefully start/forward the migration process.
     *
     * This is an edge-case version of [`Self::force_set_cursor`] that allows to set the
     * `started_at` value to the next block number. Otherwise this would not be possible, since
     * `force_set_cursor` takes an absolute block number. Setting `started_at` to `None`
     * indicates that the current block number plus one should be used.
     */
    force_set_active_cursor: TxDescriptor<Anonymize<Id6nbvqoqdj4o2>>;
    /**
     * Forces the onboarding of the migrations.
     *
     * This process happens automatically on a runtime upgrade. It is in place as an emergency
     * measurement. The cursor needs to be `None` for this to succeed.
     */
    force_onboard_mbms: TxDescriptor<undefined>;
    /**
     * Clears the `Historic` set.
     *
     * `map_cursor` must be set to the last value that was returned by the
     * `HistoricCleared` event. The first time `None` can be used. `limit` must be chosen in a
     * way that will result in a sensible weight.
     */
    clear_historic: TxDescriptor<Anonymize<I95iqep3b8snn9>>;
  };
  Sudo: {
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     */
    sudo: TxDescriptor<Anonymize<I77l5dsi0gnac7>>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Root` origin.
     * This function does not check the weight of the call, and instead allows the
     * Sudo user to specify the weight of the call.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    sudo_unchecked_weight: TxDescriptor<Anonymize<I1q7iisvnsn9jn>>;
    /**
     * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
     * key.
     */
    set_key: TxDescriptor<Anonymize<I8k3rnvpeeh4hv>>;
    /**
     * Authenticates the sudo key and dispatches a function call with `Signed` origin from
     * a given account.
     *
     * The dispatch origin for this call must be _Signed_.
     */
    sudo_as: TxDescriptor<Anonymize<I5a1mcnnhp9s1k>>;
    /**
     * Permanently removes the sudo key.
     *
     * **This cannot be un-done.**
     */
    remove_key: TxDescriptor<undefined>;
  };
  XcmpQueue: {
    /**
     * Suspends all XCM executions for the XCMP queue, regardless of the sender's origin.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    suspend_xcm_execution: TxDescriptor<undefined>;
    /**
     * Resumes all XCM executions for the XCMP queue.
     *
     * Note that this function doesn't change the status of the in/out bound channels.
     *
     * - `origin`: Must pass `ControllerOrigin`.
     */
    resume_xcm_execution: TxDescriptor<undefined>;
    /**
     * Overwrites the number of pages which must be in the queue for the other side to be
     * told to suspend their sending.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.suspend_value`
     */
    update_suspend_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
    /**
     * Overwrites the number of pages which must be in the queue after which we drop any
     * further messages from the channel.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.drop_threshold`
     */
    update_drop_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
    /**
     * Overwrites the number of pages which the queue must be reduced to before it signals
     * that message sending may recommence after it has been suspended.
     *
     * - `origin`: Must pass `Root`.
     * - `new`: Desired value for `QueueConfigData.resume_threshold`
     */
    update_resume_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
  };
  MessageQueue: {
    /**
     * Remove a page which has no more messages remaining to be processed or is stale.
     */
    reap_page: TxDescriptor<Anonymize<I40pqum1mu8qg3>>;
    /**
     * Execute an overweight message.
     *
     * Temporary processing errors will be propagated whereas permanent errors are treated
     * as success condition.
     *
     * - `origin`: Must be `Signed`.
     * - `message_origin`: The origin from which the message to be executed arrived.
     * - `page`: The page in the queue in which the message to be executed is sitting.
     * - `index`: The index into the queue of the message to be executed.
     * - `weight_limit`: The maximum amount of weight allowed to be consumed in the execution
     * of the message.
     *
     * Benchmark complexity considerations: O(index + weight_limit).
     */
    execute_overweight: TxDescriptor<Anonymize<I1r4c2ghbtvjuc>>;
  };
  PolkadotXcm: {
    /**
        
         */
    send: TxDescriptor<Anonymize<Ia5cotcvi888ln>>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * **This function is deprecated: Use `limited_teleport_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    teleport_assets: TxDescriptor<Anonymize<I21jsa919m88fd>>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * **This function is deprecated: Use `limited_reserve_transfer_assets` instead.**
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
     * with all fees taken as needed from the asset.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     */
    reserve_transfer_assets: TxDescriptor<Anonymize<I21jsa919m88fd>>;
    /**
     * Execute an XCM message from a local, signed, origin.
     *
     * An event is deposited indicating whether `msg` could be executed completely or only
     * partially.
     *
     * No more than `max_weight` will be used in its attempted execution. If this is less than
     * the maximum amount of weight that the message could take to be executed, then no
     * execution attempt will be made.
     */
    execute: TxDescriptor<Anonymize<Iegif7m3upfe1k>>;
    /**
     * Extoll that a particular destination can be communicated with through a particular
     * version of XCM.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The destination that is being described.
     * - `xcm_version`: The latest version of XCM that `location` supports.
     */
    force_xcm_version: TxDescriptor<Anonymize<I9kt8c221c83ln>>;
    /**
     * Set a safe XCM version (the version that XCM should be encoded with if the most recent
     * version a destination can accept is unknown).
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `maybe_xcm_version`: The default XCM encoding version, or `None` to disable.
     */
    force_default_xcm_version: TxDescriptor<Anonymize<Ic76kfh5ebqkpl>>;
    /**
     * Ask a location to notify us regarding their XCM version and any changes to it.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we should subscribe for XCM version notifications.
     */
    force_subscribe_version_notify: TxDescriptor<Anonymize<Icscpmubum33bq>>;
    /**
     * Require that a particular destination should no longer notify us regarding any XCM
     * version changes.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `location`: The location to which we are currently subscribed for XCM version
     * notifications which we no longer desire.
     */
    force_unsubscribe_version_notify: TxDescriptor<Anonymize<Icscpmubum33bq>>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve.
     *
     * `assets` must have same reserve location and may not be teleportable to `dest`.
     * - `assets` have local reserve: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `assets` have destination reserve: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
     * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
     * to mint and deposit reserve-based assets to `beneficiary`.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    limited_reserve_transfer_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
    /**
     * Teleport some assets from the local chain to some destination chain.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` chain.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    limited_teleport_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
    /**
     * Set or unset the global suspension state of the XCM executor.
     *
     * - `origin`: Must be an origin specified by AdminOrigin.
     * - `suspended`: `true` to suspend, `false` to resume.
     */
    force_suspension: TxDescriptor<Anonymize<Ibgm4rnf22lal1>>;
    /**
     * Transfer some assets from the local chain to the destination chain through their local,
     * destination or remote reserve, or through teleports.
     *
     * Fee payment on the destination side is made from the asset in the `assets` vector of
     * index `fee_asset_item` (hence referred to as `fees`), up to enough to pay for
     * `weight_limit` of weight. If more weight is needed than `weight_limit`, then the
     * operation will fail and the sent assets may be at risk.
     *
     * `assets` (excluding `fees`) must have same reserve location or otherwise be teleportable
     * to `dest`, no limitations imposed on `fees`.
     * - for local reserve: transfer assets to sovereign account of destination chain and
     * forward a notification XCM to `dest` to mint and deposit reserve-based assets to
     * `beneficiary`.
     * - for destination reserve: burn local assets and forward a notification to `dest` chain
     * to withdraw the reserve assets from this chain's sovereign account and deposit them
     * to `beneficiary`.
     * - for remote reserve: burn local assets, forward XCM to reserve chain to move reserves
     * from this chain's SA to `dest` chain's SA, and forward another XCM to `dest` to mint
     * and deposit reserve-based assets to `beneficiary`.
     * - for teleports: burn local assets and forward XCM to `dest` chain to mint/teleport
     * assets and deposit them to `beneficiary`.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `X2(Parent,
     * Parachain(..))` to send from parachain to parachain, or `X1(Parachain(..))` to send
     * from relay to parachain.
     * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
     * generally be an `AccountId32` value.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
     * fees.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    transfer_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
    /**
     * Claims assets trapped on this pallet because of leftover assets during XCM execution.
     *
     * - `origin`: Anyone can call this extrinsic.
     * - `assets`: The exact assets that were trapped. Use the version to specify what version
     * was the latest when they were trapped.
     * - `beneficiary`: The location/account where the claimed assets will be deposited.
     */
    claim_assets: TxDescriptor<Anonymize<Ie68np0vpihith>>;
    /**
     * Transfer assets from the local chain to the destination chain using explicit transfer
     * types for assets and fees.
     *
     * `assets` must have same reserve location or may be teleportable to `dest`. Caller must
     * provide the `assets_transfer_type` to be used for `assets`:
     * - `TransferType::LocalReserve`: transfer assets to sovereign account of destination
     * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
     * assets to `beneficiary`.
     * - `TransferType::DestinationReserve`: burn local assets and forward a notification to
     * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
     * deposit them to `beneficiary`.
     * - `TransferType::RemoteReserve(reserve)`: burn local assets, forward XCM to `reserve`
     * chain to move reserves from this chain's SA to `dest` chain's SA, and forward another
     * XCM to `dest` to mint and deposit reserve-based assets to `beneficiary`. Typically
     * the remote `reserve` is Asset Hub.
     * - `TransferType::Teleport`: burn local assets and forward XCM to `dest` chain to
     * mint/teleport assets and deposit them to `beneficiary`.
     *
     * On the destination chain, as well as any intermediary hops, `BuyExecution` is used to
     * buy execution using transferred `assets` identified by `remote_fees_id`.
     * Make sure enough of the specified `remote_fees_id` asset is included in the given list
     * of `assets`. `remote_fees_id` should be enough to pay for `weight_limit`. If more weight
     * is needed than `weight_limit`, then the operation will fail and the sent assets may be
     * at risk.
     *
     * `remote_fees_id` may use different transfer type than rest of `assets` and can be
     * specified through `fees_transfer_type`.
     *
     * The caller needs to specify what should happen to the transferred assets once they reach
     * the `dest` chain. This is done through the `custom_xcm_on_dest` parameter, which
     * contains the instructions to execute on `dest` as a final step.
     * This is usually as simple as:
     * `Xcm(vec![DepositAsset { assets: Wild(AllCounted(assets.len())), beneficiary }])`,
     * but could be something more exotic like sending the `assets` even further.
     *
     * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
     * - `dest`: Destination context for the assets. Will typically be `[Parent,
     * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
     * relay to parachain, or `(parents: 2, (GlobalConsensus(..), ..))` to send from
     * parachain across a bridge to another ecosystem destination.
     * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
     * fee on the `dest` (and possibly reserve) chains.
     * - `assets_transfer_type`: The XCM `TransferType` used to transfer the `assets`.
     * - `remote_fees_id`: One of the included `assets` to be used to pay fees.
     * - `fees_transfer_type`: The XCM `TransferType` used to transfer the `fees` assets.
     * - `custom_xcm_on_dest`: The XCM to be executed on `dest` chain as the last step of the
     * transfer, which also determines what happens to the assets on the destination chain.
     * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
     */
    transfer_assets_using_type_and_then: TxDescriptor<Anonymize<I9bnv6lu0crf1q>>;
    /**
     * Authorize another `aliaser` location to alias into the local `origin` making this call.
     * The `aliaser` is only authorized until the provided `expiry` block number.
     * The call can also be used for a previously authorized alias in order to update its
     * `expiry` block number.
     *
     * Usually useful to allow your local account to be aliased into from a remote location
     * also under your control (like your account on another chain).
     *
     * WARNING: make sure the caller `origin` (you) trusts the `aliaser` location to act in
     * their/your name. Once authorized using this call, the `aliaser` can freely impersonate
     * `origin` in XCM programs executed on the local chain.
     */
    add_authorized_alias: TxDescriptor<Anonymize<Iauhjqifrdklq7>>;
    /**
     * Remove a previously authorized `aliaser` from the list of locations that can alias into
     * the local `origin` making this call.
     */
    remove_authorized_alias: TxDescriptor<Anonymize<Ie1uso9m8rt5cf>>;
    /**
     * Remove all previously authorized `aliaser`s that can alias into the local `origin`
     * making this call.
     */
    remove_all_authorized_aliases: TxDescriptor<undefined>;
  };
  CollatorSelection: {
    /**
     * Set the list of invulnerable (fixed) collators. These collators must do some
     * preparation, namely to have registered session keys.
     *
     * The call will remove any accounts that have not registered keys from the set. That is,
     * it is non-atomic; the caller accepts all `AccountId`s passed in `new` _individually_ as
     * acceptable Invulnerables, and is not proposing a _set_ of new Invulnerables.
     *
     * This call does not maintain mutual exclusivity of `Invulnerables` and `Candidates`. It
     * is recommended to use a batch of `add_invulnerable` and `remove_invulnerable` instead. A
     * `batch_all` can also be used to enforce atomicity. If any candidates are included in
     * `new`, they should be removed with `remove_invulnerable_candidate` after execution.
     *
     * Must be called by the `UpdateOrigin`.
     */
    set_invulnerables: TxDescriptor<Anonymize<Ifccifqltb5obi>>;
    /**
     * Set the ideal number of non-invulnerable collators. If lowering this number, then the
     * number of running collators could be higher than this figure. Aside from that edge case,
     * there should be no other way to have more candidates than the desired number.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    set_desired_candidates: TxDescriptor<Anonymize<Iadtsfv699cq8b>>;
    /**
     * Set the candidacy bond amount.
     *
     * If the candidacy bond is increased by this call, all current candidates which have a
     * deposit lower than the new bond will be kicked from the list and get their deposits
     * back.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    set_candidacy_bond: TxDescriptor<Anonymize<Ialpmgmhr3gk5r>>;
    /**
     * Register this account as a collator candidate. The account must (a) already have
     * registered session keys and (b) be able to reserve the `CandidacyBond`.
     *
     * This call is not available to `Invulnerable` collators.
     */
    register_as_candidate: TxDescriptor<undefined>;
    /**
     * Deregister `origin` as a collator candidate. Note that the collator can only leave on
     * session change. The `CandidacyBond` will be unreserved immediately.
     *
     * This call will fail if the total number of candidates would drop below
     * `MinEligibleCollators`.
     */
    leave_intent: TxDescriptor<undefined>;
    /**
     * Add a new account `who` to the list of `Invulnerables` collators. `who` must have
     * registered session keys. If `who` is a candidate, they will be removed.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    add_invulnerable: TxDescriptor<Anonymize<I4cbvqmqadhrea>>;
    /**
     * Remove an account `who` from the list of `Invulnerables` collators. `Invulnerables` must
     * be sorted.
     *
     * The origin for this call must be the `UpdateOrigin`.
     */
    remove_invulnerable: TxDescriptor<Anonymize<I4cbvqmqadhrea>>;
    /**
     * Update the candidacy bond of collator candidate `origin` to a new amount `new_deposit`.
     *
     * Setting a `new_deposit` that is lower than the current deposit while `origin` is
     * occupying a top-`DesiredCandidates` slot is not allowed.
     *
     * This call will fail if `origin` is not a collator candidate, the updated bond is lower
     * than the minimum candidacy bond, and/or the amount cannot be reserved.
     */
    update_bond: TxDescriptor<Anonymize<I3sdol54kg5jaq>>;
    /**
     * The caller `origin` replaces a candidate `target` in the collator candidate list by
     * reserving `deposit`. The amount `deposit` reserved by the caller must be greater than
     * the existing bond of the target it is trying to replace.
     *
     * This call will fail if the caller is already a collator candidate or invulnerable, the
     * caller does not have registered session keys, the target is not a collator candidate,
     * and/or the `deposit` amount cannot be reserved.
     */
    take_candidate_slot: TxDescriptor<Anonymize<I8fougodaj6di6>>;
  };
  Session: {
    /**
     * Sets the session key(s) of the function caller to `keys`.
     *
     * Allows an account to set its session key prior to becoming a validator.
     * This doesn't take effect until the next session.
     *
     * - `origin`: The dispatch origin of this function must be signed.
     * - `keys`: The new session keys to set. These are the public keys of all sessions keys
     * setup in the runtime.
     * - `proof`: The proof that `origin` has access to the private keys of `keys`. See
     * [`impl_opaque_keys`](sp_runtime::impl_opaque_keys) for more information about the
     * proof format.
     */
    set_keys: TxDescriptor<Anonymize<I81vt5eq60l4b6>>;
    /**
     * Removes any session key(s) of the function caller.
     *
     * This doesn't take effect until the next session.
     *
     * The dispatch origin of this function must be Signed and the account must be either be
     * convertible to a validator ID using the chain's typical addressing system (this usually
     * means being a controller account) or directly convertible into a validator ID (which
     * usually means being a stash account).
     */
    purge_keys: TxDescriptor<undefined>;
  };
  Constitution: {
    /**
     * `constitution.set_param` — update one typed, bounded, rate-limited
     * 13 §1 key (I-6).
     *
     * Authority matrix (06 §3.2): PARAM-class keys ⇒ `FutarchyParam`;
     * TREASURY ⇒ `FutarchyTreasury`; META **and META+values** ⇒
     * `FutarchyMeta` (06 §1 bars values from parameter keys; the values
     * half of the dual consent is the guard's execute-time ratification,
     * 06 §2.2 — PLAN SQ-6); CONST/entrenched ⇒ values-layer origins. The
     * welfare low knees are direction-scoped further: constitution raises,
     * entrenched lowers (05 §4.1).
     * No Root path — 09 §5.4's bootstrap-sudo scope is exhaustive and
     * excludes parameter administration (PLAN SQ-11).
     */
    set_param: TxDescriptor<Anonymize<Irupv22iu38vu>>;
    /**
     * `constitution.set_capability` — insert or replace one capability
     * row (06 §3.2 row 4: a `FutarchyMeta` call; values participates via
     * the rule-altering ratification of 06 §2.2, never direct dispatch).
     *
     * Mirrors `ConstitutionState::set_capability` over the bounded
     * storage form (upsert by `(class, capability)`, bound
     * [`MAX_CAPABILITIES`]); the differential test pins equivalence.
     */
    set_capability: TxDescriptor<Anonymize<I7grtu814479f3>>;
    /**
     * `constitution.set_phase_flag` — set/clear 02 §7.3 **arming** bits.
     *
     * Root-only and bit-scoped: the sole origin-mediated flag writer the
     * spec names is bootstrap sudo, whose powers include "arming phase
     * flags on evidence" (09 §5.4, Phases 0–3; the Phase-3→4 upgrade
     * removes Root, after which arming bits move with phase-advancement
     * upgrades, 09 §5.2). Only `PhaseFlagsValue::SUDO_ARMABLE_MASK`
     * (bits 0–4) is writable here; the machinery bits — 5 ledger-frozen,
     * 6 dead-man, 7 reserve-health — belong to sibling-pallet state and
     * are reachable only through their dedicated internal setters, so
     * even sudo cannot fake or clear a freeze/dead-man/reserve signal.
     * Full per-bit writer map is PLAN SQ-5. Reserved bits 8–31 rejected.
     */
    set_phase_flag: TxDescriptor<Anonymize<I93s1mcesjtqu3>>;
    /**
     * `constitution.set_release_channel` — 02 §12 writer (b): the
     * scoped constitution track rewrites the D-14 fixed layout on a
     * canonical repoint, `min_supported_version` bump or key revocation;
     * internal construction may use bare `ConstitutionalValues`.
     * Offsets 112–119 and `URGENT_UPGRADE` are preserved from storage:
     * they are owned exclusively by the execution guard (I-30). Offset
     * 108 `updated_at` is stamped from the current block, never taken
     * from the caller's bytes — 02 §12 makes it the block of the last
     * write, and a caller-chosen value would let a lawful writer
     * backdate the freshness a stranded reader depends on.
     * No other origin — including bootstrap Root — may dispatch this;
     * writer (a) is the execution guard's [`Pallet::note_release_channel`].
     */
    set_release_channel: TxDescriptor<Anonymize<I1p86ntl6dn03c>>;
    /**
     * `constitution.amend_registry` — amend one key's governance
     * metadata (bounds / max-Δ / cooldown), never its value, class or
     * key set (06 §3.2 row 4; 13 rule 7).
     *
     * Origin: **`FutarchyMeta` only** (SQ-150 ruling 2026-07-21) — non-kernel
     * rows are META-amendable within meta-bounds; the former
     * `ConstitutionalValues`/track paths are removed so no values path can
     * retune metadata the classifier already treats as a belief-side call.
     * Kernel-bounded rows are **immutable**: `checked_amend` refuses them
     * with `KernelBoundImmutable` even under `FutarchyMeta`, so the two
     * error surfaces are `BadOrigin` (any non-META origin) and
     * `KernelBoundImmutable` (META on a kernel row). Every accepted
     * amendment keeps `min ≤ value ≤ max`, preserves the value kind, and
     * keeps `cooldown ≤ 8` epochs. Registry rows are never inserted or
     * removed on-chain — new keys arrive with runtime upgrades (13 §4: the
     * key set is genesis-fixed).
     */
    amend_registry: TxDescriptor<Anonymize<I3ri98utbddtsd>>;
  };
  ConditionalLedger: {
    /**
     * 03 §5.1. Split `a` USDC into `a` Accept-USDC + `a` Reject-USDC.
     */
    split: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.1. Burn a complete Accept+Reject pair, pay `a` USDC out (par).
     */
    merge: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.1. Split branch-USDC into a LONG/SHORT scalar set.
     */
    split_scalar: TxDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * 03 §5.1. Merge a LONG/SHORT set back to branch-USDC.
     */
    merge_scalar: TxDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * 03 §5.1. Split branch-USDC into a gate YES/NO set.
     */
    split_gate: TxDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * 03 §5.1. Merge a gate YES/NO set back to branch-USDC.
     */
    merge_gate: TxDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * 03 §5.1. Move `a` of a position to another account. The recipient pays
     * the storage deposit (03 §4); the R-2 remainder sweep applies to Signed
     * senders.
     */
    transfer: TxDescriptor<Anonymize<Ideepm5vhbl12g>>;
    /**
     * 03 §5.1. Baseline split.
     */
    split_baseline: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.1. Baseline merge.
     */
    merge_baseline: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.2. `Open → Resolved(w)` (`ResolveAuthority`, exactly once, I-3).
     */
    resolve: TxDescriptor<Anonymize<I3l1prg489cgso>>;
    /**
     * 03 §5.2. `Open|Resolved → Voided` (`ResolveAuthority`, not from
     * `ScalarSettled`). Records the terminal block for reaping.
     */
    void: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * 03 §5.2. `Resolved(w) → ScalarSettled{w,s}` (`SettleAuthority`).
     */
    settle_scalar: TxDescriptor<Anonymize<I8b0duu38170aj>>;
    /**
     * 03 §5.2. Record a winning-branch gate breach outcome (`SettleAuthority`).
     */
    settle_gate: TxDescriptor<Anonymize<I7445bslhc0ic2>>;
    /**
     * 03 §5.2. Settle a Baseline vault (`SettleAuthority`).
     */
    settle_baseline: TxDescriptor<Anonymize<Id6e8lk3pfjocj>>;
    /**
     * 03 §5.3. Redeem winning branch-USDC 1:1 (`ScalarSettled`).
     */
    redeem: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.3. Redeem a single scalar leg with maker-adverse flooring (B-5).
     */
    redeem_scalar: TxDescriptor<Anonymize<I449ug3537vfu2>>;
    /**
     * 03 §5.3. Redeem a complete LONG+SHORT pair for exactly `a` (no double
     * flooring, R-1).
     */
    redeem_scalar_pair: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.3. Redeem the winning side of a settled gate 1:1.
     */
    redeem_gate: TxDescriptor<Anonymize<I7r9r972bl7s6h>>;
    /**
     * 03 §5.3. VOID redemption: branch-USDC `floor(a/2)`, legs `floor(a/4)`.
     */
    redeem_void: TxDescriptor<Anonymize<I45orgf9ulklgj>>;
    /**
     * 03 §5.3. Redeem a single Baseline leg.
     */
    redeem_baseline: TxDescriptor<Anonymize<I7gp5f34oc7pki>>;
    /**
     * 03 §5.3. Redeem a complete Baseline pair for exactly `a`.
     */
    redeem_baseline_pair: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.4. Keeper crank: drain ≤ `ReapBatch` `Positions` entries of a
     * terminal, archive-elapsed proposal vault, refunding deposits; when fully
     * drained, sweep residual escrow to INSURANCE and remove the vault.
     */
    sweep_dust: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * 03 §5.4. Keeper crank for Baseline vaults.
     */
    sweep_dust_baseline: TxDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
     * PB-RESERVE effect endpoint (06 §6.2). Only public split inflows are
     * gated; every exit/recovery path remains live.
     */
    set_split_paused: TxDescriptor<Anonymize<I6qcvfaiubjt05>>;
    /**
     * PB-LEDGER-FREEZE effect endpoint (06 §6.3). No balances or
     * positions move in this call; it only installs/removes the gate.
     */
    set_frozen: TxDescriptor<Anonymize<I7tjbm7l304tu9>>;
    /**
     * Permissionless O(1) I-4 reconciliation crank (03 §5.4).
     *
     * `TotalEscrowed` is transactionally maintained by every escrow delta;
     * `try_state` independently re-sums the unbounded claimant-retained vault
     * maps. This dispatch therefore never performs an unbounded scan.
     */
    reconcile: TxDescriptor<undefined>;
    /**
     * 03 §5.4 / §5.3a(4). Permissionless O(1) keeper crank: move the whole
     * accrued redemption fee from the sovereign to the treasury `MAIN`
     * account and zero the counter, atomically.
     *
     * A sweep on an **empty** counter is a successful no-op, not an error
     * (I-31; §5.3a(6) introduces no error and the §8 list is frozen). It
     * moves surplus, never escrow: `TotalEscrowed`, every vault's
     * `escrowed` and every supply field are untouched, so it cannot
     * underflow — the counter only ever accumulates amounts already
     * withheld from completed payouts. `Preservation::Preserve` keeps the
     * sovereign above its R-4 permanent floor, which L-7 is what makes
     * safe: the accrual is bounded by the surplus **above** `min_balance`,
     * so the crank can always pay out in full.
     *
     * **Frozen under `PB-LEDGER-FREEZE`** (06 §6.3; SQ-517). L-7 is a
     * conditional, and its condition is the negation of the I-4 drift
     * flag: the bound reads `RedemptionFeesAccrued ≤ balance −
     * TotalEscrowed − held_deposits − min_balance`, while the flag says
     * exactly that `TotalEscrowed + held_deposits > balance` — so under
     * the one state that authorizes a freeze the bound is *negative* and
     * there is no surplus to sweep. "Moves surplus, never escrow" then
     * stops being true, and `Preservation::Preserve` does not rescue it:
     * it protects `min_balance` and is indifferent to escrow. Refusing
     * here is what keeps the paragraph above accurate on every path this
     * crank can actually take.
     */
    sweep_redemption_fees: TxDescriptor<undefined>;
  };
  Market: {
    /**
     * Buy LONG or SHORT from an LMSR book (04 §6).
     */
    buy: TxDescriptor<Anonymize<I7kcd6p94nv55v>>;
    /**
     * Sell LONG or SHORT into an LMSR book (04 §6).
     */
    sell: TxDescriptor<Anonymize<I483r8098di3t5>>;
    /**
     * Permissionless TWAP observation keeper (04 §7).
     */
    crank_observe: TxDescriptor<Anonymize<Ico0ou8pmf1cq5>>;
    /**
     * Permissionlessly realize a closed book's protocol value once its
     * owning vault is terminal — the 04 §2 **Sweep** stage, and the custody
     * half of 08 §8 step 5. Every **realizable** position the book account
     * holds is redeemed to real USDC and returned to the account that
     * funded the seed (`POL` for decision and gate books, `POL_BASELINE`
     * for the Baseline book), and the treasury's matching budget line is
     * credited so `NAV` recognizes the custody again.
     *
     * "Realizable" is not "complete sets": after any asymmetric walk the
     * book holds complete sets **plus an unmatched residual leg**, because
     * delivery removes single legs while revenue recycling mints pairs, and
     * at an interior `s` that leg pays `floor(a·s)`/`floor(a·(1−s)) > 0`.
     * Returning only the sets would leave exactly that value for reap to
     * discard into ledger residue bound for `INSURANCE` — the 08 §10.5 leak
     * this milestone exists to close. Only provably zero-payout positions
     * are left behind: losing-branch instruments and the losing side of a
     * settled gate.
     *
     * Idempotent: the swept marker is written in the same storage layer as
     * the remittance, so a repeat call is a successful no-op rather than a
     * second payment and a partially applied sweep is unreachable.
     * Fail-soft: it is a separate crank that no settlement path calls, so
     * it can never fail a settlement (G-1); a failure leaves the book
     * unswept, unreapable and retryable — an NAV-recognition delay, not a
     * solvency defect, since the value is still fully collateralized in the
     * ledger sovereign.
     *
     * The **fee leg** (E2) runs in the same atomic layer and is what makes
     * the market fee a revenue instrument rather than a sink (04 §6.1;
     * 08 §1.1). It has two shapes because collection has two: a decision or
     * gate book accrues branch-USDC into its fee account, which redeems to
     * USDC paid straight to `MAIN`; a Baseline book retains its sell-side
     * fee as **plain USDC** in the book account, which is transferred above
     * the 03 §7 R-4 `min_balance` floor and leaves that floor exactly where
     * R-4 puts it. Reaching `MAIN` custody is only half of it — `nav()` is
     * computed from the treasury's internal `main_usdc` counter, so the
     * arrival is recognized through [`MainRevenueSink`] in the same layer.
     *
     * **Frozen by the owning ledger domain's I-4 status** (04 §2; 06
     * §6.3; 16 §10; I-37), because the fee leg redeems through an
     * *internal* ledger path. Protocol books consult the primary market
     * freeze; external books consult only the service instance's freeze.
     * An unguarded sweep could collect the protocol's own claim out of a
     * possibly-short sovereign while that domain's claimants are refused,
     * while consulting the other domain would wrongly strand independent
     * capital. The crank effects no terminal transition, so delaying it
     * until its own ledger is payout-safe leaves value collateralized and
     * retryable.
     */
    sweep_revenue: TxDescriptor<Anonymize<Ico0ou8pmf1cq5>>;
    /**
     * Permissionlessly reap a closed book after `ArchiveDelay` (04 §2).
     */
    reap: TxDescriptor<Anonymize<Ico0ou8pmf1cq5>>;
    /**
     * PB-DEPEG effect endpoint: freeze only new market creation/seeding.
     */
    freeze_creation: TxDescriptor<Anonymize<Ie38ogc3bkfpu>>;
    /**
     * PB-LEDGER-FREEZE effect endpoint. `true` installs exactly the
     * kernel 14-day backstop; `false` clears early/reverts expiry.
     */
    set_frozen: TxDescriptor<Anonymize<I7tjbm7l304tu9>>;
  };
  Welfare: {
    /**
     * Register a metric-track-approved version. Activation is implicit and
     * the core enforces the two-epoch lead time.
     */
    register_spec: TxDescriptor<Anonymize<Iasovm2m56clga>>;
    /**
     * Permissionless signed keeper crank for one **finalized** epoch's
     * snapshot. The epoch must have closed (`epoch < CurrentEpoch`; 05 §4.6
     * winsorizes over finalized epoch values), else the crank is rejected —
     * this stops an early/future call from locking a wrong `W` or consuming
     * the bounded snapshot window before the real counters exist.
     */
    record_snapshot: TxDescriptor<Anonymize<I3s764kupqvvc3>>;
    /**
     * Permissionless signed keeper crank for a **finalized** epoch's daily
     * S/C gate sample. Like `record_snapshot`, the epoch must have closed
     * (`epoch < CurrentEpoch`) so the day's counters are final (05 §4.7).
     *
     * `day` must lie in the epoch's **measurable day set** (05 §4.7): its
     * whole days, floored at one. `MAX_DAILY_GATE_SAMPLES` is the *storage*
     * bound on the breach bitmap and is not the semantic bound — for every
     * permitted `epoch.length` there are day indices below it that the epoch
     * never contained, and resolving one of those would let a keeper drive
     * `C_daily` down out of components that were never measured (`X` reads
     * its no-traffic 1, `K` reads 0 because nobody authored in a day that
     * never elapsed, `R` refuses). The day is therefore refused, not
     * resolved to any value.
     */
    record_daily_gate: TxDescriptor<Anonymize<Ide781hv7v8ek3>>;
  };
  Oracle: {
    /**
     * `oracle.register_reporter` — permissionless entry, `orc.reporter_stake`
     * held (07 §3). Signed.
     */
    register_reporter: TxDescriptor<undefined>;
    /**
     * `oracle.deregister_reporter` — exit once every round the reporter
     * participated in is closed; stake returned (07 §3). Signed.
     */
    deregister_reporter: TxDescriptor<undefined>;
    /**
     * `oracle.report` — attest one value for `(component, epoch)` under the
     * frozen spec version, round-1 bond held (07 §5.1). Signed by a
     * registered reporter. The window end, expected version and `StakeAtRisk`
     * are derived via [`Config::Reporting`], never taken from the caller.
     */
    report: TxDescriptor<Anonymize<I4n0jfeme2dupj>>;
    /**
     * `oracle.challenge` — post the current-round bond against a report;
     * proof of observability that supersedes the quorum rule (07 §5.2).
     * Signed. `spec_version` disambiguates per-version games (07 §2(4)).
     */
    challenge: TxDescriptor<Anonymize<Iejr8qrqkqh148>>;
    /**
     * `oracle.counter_report` — the reporter's signed consent to advance
     * a challenged game. The keeper close path never creates this round or
     * its bond; the reporter must fund it explicitly (07 §5.3).
     */
    counter_report: TxDescriptor<Anonymize<I4n0jfeme2dupj>>;
    /**
     * `oracle.recompute_proof` — permissionless mechanical resolution from
     * the committed evidence, bounded at `orc.max_proof_bytes` (07 §9).
     * Signed (keeper, rebated). Fails closed for non-recomputable
     * components, and for every component on a runtime whose
     * [`Config::RecomputeEngine`] cannot evaluate the frozen `formula_ref`.
     */
    recompute_proof: TxDescriptor<Anonymize<Ie00dqaka54s56>>;
    /**
     * `oracle.register_watchtower` — permissionless-with-stake entry,
     * `wt.stake` held, ≤ `wt.max = 16` seats (07 §4). Signed.
     */
    register_watchtower: TxDescriptor<undefined>;
    /**
     * `oracle.ack_observed` — a registered watchtower asserts a round was
     * visible in a finalized block; O(1), keeper-class rebate (07 §4).
     * Signed. `spec_version` selects the per-version round.
     */
    ack_observed: TxDescriptor<Anonymize<I97fq4k68v5pmh>>;
    /**
     * `oracle.crank_round_close(batch)` — permissionless bounded crank that
     * resolves matured rounds: quorum ⇒ final; no quorum ⇒ one extension then
     * neutral; challenged ⇒ escalate (07 §4/§5). Signed (keeper, rebated).
     */
    crank_round_close: TxDescriptor<Anonymize<Ifh9jjrch89bli>>;
    /**
     * `oracle.crank_reserve_probe` — permissionless probe crank: first counts
     * any timed-out outstanding probe as a fail (fail-static, 07 §8), then
     * sends the next probe if `res.probe_interval` has elapsed. Signed
     * (keeper, rebated). The pallet commits state first, then fires the
     * XCM-free [`ProbeDispatch`] seam; send failure remains fail-static
     * through the pending probe's timeout (I-24, rule 7).
     */
    crank_reserve_probe: TxDescriptor<undefined>;
    /**
     * `oracle.adjudicate` — the sole privileged call: the `OracleResolution`
     * values track settles a terminal dispute and, if the reporter is found
     * wrong, forfeits its bond stack (07 §5.4/§5.5).
     */
    adjudicate: TxDescriptor<Anonymize<I17o91bl727r0j>>;
  };
  IncidentRegistry: {
    /**
     * 07 §7. File a bonded claim about an off-chain fact. Holds the
     * value-scaled bond floored by `reg.bond_{incident,milestone}`, then
     * opens a 72 h challenge window under the §4 quorum rule.
     */
    file: TxDescriptor<Anonymize<Idbt6597auf3g2>>;
    /**
     * 07 §7. Challenge a live filing, posting the matching bond; opens the
     * single counter-round (registry games do not escalate).
     */
    challenge_filing: TxDescriptor<Anonymize<I3nkq26pmovr9u>>;
    /**
     * 07 §4/§7. A registered watchtower acknowledges a filing's
     * observability. O(1); the runtime rebates the keeper-class fee.
     */
    ack_observed: TxDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * 07 §7. Keeper crank: close ≤ `REG_CLOSE_BATCH` due filings of `epoch` —
     * unchallenged + quorum ⇒ upheld (bond refunded); quorum failure ⇒ one
     * 48 h extension, then rejected-as-unobservable (bond refunded, §4).
     */
    crank_close: TxDescriptor<Anonymize<Ict5mnga93gs4g>>;
    /**
     * 07 §7. Resolve a challenged filing's counter-round: the loser forfeits
     * the bond 40 / 60. The verdict arrives on the `OracleResolution` values
     * track (07 §5.4) via [`Config::ResolutionAuthority`], which is the
     * registry's **only** terminal path — §9's mechanical `recompute_proof`
     * needs a `formula_ref` a bonded off-chain-fact claim does not have, and
     * §7's escalation alternative needs a `(component, epoch)` game that an
     * Incident filing has no component for (`I` is not a `MetricId`).
     *
     * `evidence_hash` must restate the hash the challenge committed, and the
     * counter-round window must have elapsed. Both bind the discretion the
     * single terminal path necessarily carries (SQ-294).
     */
    resolve_challenge: TxDescriptor<Anonymize<If97gtgn6okleo>>;
    /**
     * 07 §7. Keeper: once every filing of `epoch` is terminal, derive the
     * aggregate (Incident: `max(0, 1 − Σ severity)`, "no filings ⇒ 1";
     * Milestone: `points ÷ target`) and hand it to welfare.
     */
    close_epoch: TxDescriptor<Anonymize<I3s764kupqvvc3>>;
    /**
     * 07 §7. Keeper: reap a closed epoch's archived filings + acks + the
     * aggregate — only once `ArchiveDelay` blocks have elapsed since close, so
     * welfare has consumed the aggregate (cohort settlement) before the
     * records are destroyed. A permissionless reap without this gate would let
     * a griefer erase an incident before settlement and re-open the epoch.
     */
    reap_epoch: TxDescriptor<Anonymize<I3s764kupqvvc3>>;
  };
  MilestoneRegistry: {
    /**
     * 07 §7. File a bonded claim about an off-chain fact. Holds the
     * value-scaled bond floored by `reg.bond_{incident,milestone}`, then
     * opens a 72 h challenge window under the §4 quorum rule.
     */
    file: TxDescriptor<Anonymize<Idbt6597auf3g2>>;
    /**
     * 07 §7. Challenge a live filing, posting the matching bond; opens the
     * single counter-round (registry games do not escalate).
     */
    challenge_filing: TxDescriptor<Anonymize<I3nkq26pmovr9u>>;
    /**
     * 07 §4/§7. A registered watchtower acknowledges a filing's
     * observability. O(1); the runtime rebates the keeper-class fee.
     */
    ack_observed: TxDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * 07 §7. Keeper crank: close ≤ `REG_CLOSE_BATCH` due filings of `epoch` —
     * unchallenged + quorum ⇒ upheld (bond refunded); quorum failure ⇒ one
     * 48 h extension, then rejected-as-unobservable (bond refunded, §4).
     */
    crank_close: TxDescriptor<Anonymize<Ict5mnga93gs4g>>;
    /**
     * 07 §7. Resolve a challenged filing's counter-round: the loser forfeits
     * the bond 40 / 60. The verdict arrives on the `OracleResolution` values
     * track (07 §5.4) via [`Config::ResolutionAuthority`], which is the
     * registry's **only** terminal path — §9's mechanical `recompute_proof`
     * needs a `formula_ref` a bonded off-chain-fact claim does not have, and
     * §7's escalation alternative needs a `(component, epoch)` game that an
     * Incident filing has no component for (`I` is not a `MetricId`).
     *
     * `evidence_hash` must restate the hash the challenge committed, and the
     * counter-round window must have elapsed. Both bind the discretion the
     * single terminal path necessarily carries (SQ-294).
     */
    resolve_challenge: TxDescriptor<Anonymize<If97gtgn6okleo>>;
    /**
     * 07 §7. Keeper: once every filing of `epoch` is terminal, derive the
     * aggregate (Incident: `max(0, 1 − Σ severity)`, "no filings ⇒ 1";
     * Milestone: `points ÷ target`) and hand it to welfare.
     */
    close_epoch: TxDescriptor<Anonymize<I3s764kupqvvc3>>;
    /**
     * 07 §7. Keeper: reap a closed epoch's archived filings + acks + the
     * aggregate — only once `ArchiveDelay` blocks have elapsed since close, so
     * welfare has consumed the aggregate (cohort settlement) before the
     * records are destroyed. A permissionless reap without this gate would let
     * a griefer erase an incident before settlement and re-open the epoch.
     */
    reap_epoch: TxDescriptor<Anonymize<I3s764kupqvvc3>>;
  };
  FutarchyTreasury: {
    /**
     * `treasury.fund_budget_line(line, amount)` — move `amount` from `MAIN`
     * into a budget line (08 §1.1). Origin: `FutarchyTreasury`, or the
     * stored ops multisig for a runway-capped reserve-probe top-up until
     * the first successful positive TREASURY reserve-probe funding.
     */
    fund_budget_line: TxDescriptor<Anonymize<I5c87v6pd2sdaf>>;
    /**
     * `treasury.spend(line, dest, amount)` — a direct in-cap grant
     * (08 §1.3/§1.4). Rejected above `trs.stream_threshold` (`StreamRequired`),
     * above `trs.cap_proposal`×NAV (`ProposalCapExceeded`), under the
     * reserve haircut (`ReserveImpaired`), or over a rolling meter
     * (`MeterExhausted`). Origin: `FutarchyTreasury`.
     */
    spend: TxDescriptor<Anonymize<I5l0jsir5si80s>>;
    /**
     * `treasury.open_stream(line, recipient, total, start, duration)` — a
     * mandatory vesting stream for a grant > `trs.stream_threshold`
     * (08 §1.3/§1.4). The `line` names the funding budget line (08 §1.1:
     * outflow calls MUST name a line; the 08 §1.4 signature omits it — see
     * PLAN note). Origin: `FutarchyTreasury`.
     */
    open_stream: TxDescriptor<Anonymize<I86uhg8ivvk3a8>>;
    /**
     * `treasury.claim_stream(id)` — the recipient claims vested funds
     * (08 §1.4, Signed recipient).
     */
    claim_stream: TxDescriptor<Anonymize<I4ov6e94l79mbg>>;
    /**
     * `treasury.cancel_stream(id)` — a later TREASURY decision cancels a
     * stream; the undisbursed remainder reverts to `MAIN` (08 §1.3).
     * Origin: `FutarchyTreasury`.
     */
    cancel_stream: TxDescriptor<Anonymize<I4ov6e94l79mbg>>;
    /**
     * `treasury.issue_vit(amount, line)` — mint VIT within the rolling
     * `iss.inflation_cap` window to a `REWARDS`/`ops.*` line (08 §2.3).
     * Origin: `FutarchyTreasury`.
     */
    issue_vit: TxDescriptor<Anonymize<I5c87v6pd2sdaf>>;
    /**
     * `treasury.recover_foreign(asset, dest, amount)` — sweep assets sent to
     * pallet accounts outside protocol flows (08 §1.3, TREASURY-class only,
     * never a protocol asset). Origin: `FutarchyTreasury`.
     */
    recover_foreign: TxDescriptor<Anonymize<I3dg8tbt6tcck6>>;
    /**
     * `treasury.execute_coretime_renewal(period_index)` — pay the
     * runtime-noted renewal quote from `ops.coretime` (09 §4). Permissionless
     * Signed keeper, idempotent per period, freeze-exempt (D-9), bounded by
     * the pre-authorized line balance and the noted quote (a keeper can
     * neither fund a period for free nor choose the amount).
     */
    execute_coretime_renewal: TxDescriptor<Anonymize<Ibnicuotj4pjfm>>;
    /**
     * Note or supersede an authenticated Coretime renewal quote (09 §4).
     */
    note_coretime_quote: TxDescriptor<Anonymize<I4gj9mv93je4sv>>;
    /**
     * Prune an expired quote, or allow its authority to prune it early.
     */
    prune_coretime_quote: TxDescriptor<Anonymize<Ibnicuotj4pjfm>>;
    /**
     * Rotate the Coretime quote authority and funded renewal account.
     */
    set_coretime_authority: TxDescriptor<Anonymize<I3f8ncpioik5na>>;
    /**
     * `treasury.sweep_insurance(amount)` — the sole admissible outflow of
     * the INSURANCE account (08 §1.2/§1.4, SQ-207).
     *
     * Origin: `FutarchyTreasury` only, i.e. a passed TREASURY-class
     * decision — no guardian power, playbook or admin origin can reach it.
     * Destination: `MAIN`, and only `MAIN`; the sweep never pays a third
     * party, so every existing control (budget lines, §1.3 rolling meters,
     * stream thresholds, the reserve-health flag) governs the funds
     * afterwards. Takes no budget line by design — it is an inbound
     * transfer *to* `MAIN`, and 08 §1.2 rejected a `BudgetLine::Insurance`
     * outright.
     *
     * INSURANCE sits outside NAV (08 §1.2), so a sweep raises NAV by
     * exactly `amount`. Custody moves under `Preservation::Preserve`: at
     * most `balance − min_balance` is sweepable and an over-large request
     * fails whole rather than reaping this 03 §7 R-4 permanent account
     * (G-1). Accounting is credited first and custody second, so a custody
     * refusal rolls the credit back with the dispatch.
     */
    sweep_insurance: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * `treasury.reconcile_insurance()` — the 08 §1.2 permissionless
     * reconciliation crank for the bounded INSURANCE reserve.
     *
     * The automatic above-target overflow covers every inflow that executes
     * treasury code. It cannot cover the rest, and 08 §1.2 says so plainly:
     * INSURANCE has a deterministic address and `ForeignAssets.transfer`
     * and its siblings are **public** calls (06 §3.3), so any account may
     * push USDC into it with no treasury code running and no interception
     * point to hook. Such a balance sits above `T_ins` until something
     * looks; this is what looks.
     *
     * Signed and permissionless, like every other keeper crank here: it
     * names no beneficiary, chooses no amount, and can move value to
     * exactly one place — `MAIN` — so there is nothing for a caller to
     * steer. Idempotent and a **no-op at or below target** (`Ok`, no
     * custody move, no event), which is what makes repeated cranking free.
     *
     * **Rebated from the ≤ 20 % general tranche when it actually moves
     * surplus** (08 §6.3; SQ-523). §6.3's closed decision-critical list
     * puts every *other* sanctioned permissionless keeper crank on the
     * general tranche, and this is one — it was the only such crank left
     * unpaid, which mattered more once SQ-518 made it the sole backstop
     * for un-interceptable direct transfers. The `> 0` condition follows
     * the orphan-Baseline precedent in the same section: a crank requests
     * a rebate only when it changes state, so the idempotent no-op at or
     * below target stays unrebated and repeated cranking cannot drain the
     * meter.
     */
    reconcile_insurance: TxDescriptor<undefined>;
    /**
     * `treasury.create_community_schedule(beneficiary, amount)` — the
     * bounded Phase-4 distribution mechanism (08 §2.1, 09 §7). A passed
     * PARAM decision authorizes one transfer from the keyless community
     * pot. The starting block is the exact block recorded by the Phase-4
     * transition; `per_block` is floor-rounded so the claimant can never
     * unlock ahead of the 24-month horizon. The SDK adapter moves custody
     * and installs the lock before the remaining pot is reduced.
     */
    create_community_schedule: TxDescriptor<Anonymize<Idscf6boak49q1>>;
    /**
     * `treasury.fund_trading_rewards(amount)` — the bounded Phase 3-4
     * trading-reward funding mechanism (08 §2.1/§2.6, 06 §3.2). A passed
     * PARAM decision retires the previous authorization's unspent
     * remainder and then moves `amount` VIT out of the `incentiv` pot
     * into the reward pallet's own sovereign account. Mirrors
     * `create_community_schedule`'s shape, as 06 §3.2 requires of any
     * future member of this pair: a fixed genesis source with a stored
     * remaining balance, a payment shape the call fixes rather than the
     * caller (the destination is [`Config::TradingRewardFunding`]'s own,
     * never a call argument), and a lifetime successful-authorization
     * count.
     *
     * The lifetime count reuses [`Config::MaxCommunitySchedules`]
     * directly rather than a duplicated same-valued constant (08 §2.6,
     * *Bounds*: "the authorization count reuses the community
     * schedule's lifetime bound") — the two calls share this Config
     * item, so an amendment of one bound moves both and neither can
     * drift from the other.
     *
     * # The return leg is folded in, and it is not a separate call
     *
     * 08 §2.6: *"The return of unspent budget carries the same authority
     * as the authorization, and MUST NOT be permissionless … the natural
     * shape is to fold it into `fund_trading_rewards` so that each new
     * authorization retires the previous one's remainder and no
     * independent surface exists at all."* A public crank would be a
     * one-extrinsic, permanent denial of the whole program's payout for
     * an epoch: reward accrual is clamped to the budget's unpromised
     * remainder, participants settle by pull, and `settle_epoch` is
     * idempotent per participant per epoch — so emptying the headroom
     * mid-settlement closes every remaining participant at a **zero**
     * reward with their score already discarded, and re-funding cannot
     * reopen a settled epoch.
     *
     * **Order is load-bearing: return first, authorize second.** The
     * other order would hand back the amount this very call just
     * authorized, leaving the sovereign empty and the pot untouched.
     *
     * **Returns the headroom, never the balance.** `TotalAccrued` in the
     * reward pallet falls only when a participant calls `claim_rewards`,
     * entirely at their own discretion and possibly long after the epoch
     * that promised it — so the sovereign routinely still holds VIT
     * backing an accrual nobody has collected. Taking the whole balance
     * would take that VIT too and leave `claim_rewards` unable to pay
     * it: nothing in the reward pallet's own settlement path breaks when
     * this is wrong, which is exactly why it would present as a program
     * that silently stops paying rather than as a visible failure.
     * [`Config::TradingRewardFunding`] reports the sovereign's balance
     * and its accrual reserve as two separate reads for exactly this
     * reason: the subtraction below is this pallet's own, not the
     * adapter's, so it is covered by this pallet's own tests rather than
     * hidden behind an implementation this pallet cannot see.
     *
     * **`amount == 0` is the wind-down, not an error.** With the return
     * folded in, a zero authorization is the only pure retire action —
     * the one call governance needs to end the program — so refusing it
     * would leave no way to return the budget without authorizing at
     * least one more planck. It is also the only path that stays open
     * once the lifetime count is full: the bound counts authorizations,
     * a zero call authorizes nothing, and gating the return on the
     * authorization bound would strand the final remainder in the
     * sovereign forever (G-1).
     */
    fund_trading_rewards: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
  };
  Guardian: {
    /**
     * `guardian.set_members` — install the seven elected council members
     * (06 §5.1). Authority: `ConstitutionalValues` (06 §3.2 row 5). Resets
     * every seat's bond to the full 50,000 VIT and, on a re-election, drops
     * the outgoing council's un-dispatched actions + approvals (the core's
     * `set_members`) so no recalled member's live approval carries over —
     * then persists the whole cleared aggregate.
     */
    set_members: TxDescriptor<Anonymize<I3ajpo6bheav6q>>;
    /**
     * `guardian.propose_action` — a member proposes an action (06 §5.1).
     * `Signed`; the member check is enforced in the core. The proposer's
     * own approval is recorded automatically.
     */
    propose_action: TxDescriptor<Anonymize<Iaoh4afnk8h0fj>>;
    /**
     * `guardian.approve_action` — a member approves a pending action
     * (06 §5.1). `Signed`; the fifth approval dispatches the action's
     * effect atomically (records it + schedules the retrospective review).
     */
    approve_action: TxDescriptor<Anonymize<Ie239vtc2egj50>>;
    /**
     * `guardian.ratify_action` — the `ratify` referendum records a passed
     * retrospective review (06 §5.4; 06 §3.2 row 6). Authority:
     * `ConstitutionalValues`.
     */
    ratify_action: TxDescriptor<Anonymize<Ie239vtc2egj50>>;
    /**
     * `guardian.renew_playbook` — the single admissible `PB-LEDGER-FREEZE`
     * renewal via a `guardian`-track referendum (06 §6.3; 06 §3.2 row 6).
     * Authority: the scoped `GuardianTrack` AdminOrigin.
     */
    renew_playbook: TxDescriptor<Anonymize<I4m6dhgb2ar055>>;
    /**
     * Uphold a `delay_once` veto through its live ratify-track review. The
     * verdict and T24 transition are one storage transaction.
     */
    uphold_veto: TxDescriptor<Anonymize<Ie239vtc2egj50>>;
    /**
     * Enact a guardian-track recall for a failed action. Every recorded
     * approver still seated is removed; residual bonds remain held for one
     * further epoch and live approvals are cleared fail-closed.
     */
    recall: TxDescriptor<Anonymize<Ie239vtc2egj50>>;
    /**
     * Enable/disable one of the six kernel-enumerated playbooks. This is
     * availability only; adding/amending a routine is a runtime change.
     */
    set_playbook_registered: TxDescriptor<Anonymize<I8m9idjg76ip7q>>;
  };
  Attestor: {
    /**
     * Install the values-elected member set (06 §3.2 row 5, §7).
     */
    set_members: TxDescriptor<Anonymize<I3c63j6sh3evqn>>;
    /**
     * Submit a member's bonded artifact attestation (06 §7). Membership
     * and duplicate checks are enforced by the core; the two admission
     * checks below are runtime-state questions the frame-free core cannot
     * answer, and both are evaluated before any write (G-1).
     */
    attest: TxDescriptor<Anonymize<Idpghfv397i03j>>;
    /**
     * Open a bonded challenge inside an attestation's 72-hour window
     * (06 §3.2 signed row, §7).
     */
    challenge_attestation: TxDescriptor<Anonymize<I1iqmhg9l6j4g5>>;
    /**
     * Resolve an open challenge through the `ratify` track (06 §7).
     * Permissionless deterministic-recomputation resolution is deferred
     * until B-track reproducible-build verification is available.
     */
    resolve_challenge: TxDescriptor<Anonymize<Ifdhckj0h8qpv2>>;
    /**
     * Remove an attestor with an explicit cause and revoke every
     * unexecuted record atomically (06 §7, contract v12).
     */
    remove_for_cause: TxDescriptor<Anonymize<I4uk5nmqsi401j>>;
    /**
     * Permissionlessly reap a terminal, settled record and release the
     * departing attestor's remaining bond basis when its last record is
     * gone.
     */
    reap_attestation: TxDescriptor<Anonymize<I7eloeoebplnvf>>;
  };
  Epoch: {
    /**
        
         */
    submit: TxDescriptor<Anonymize<Icu0h2un8nbhct>>;
    /**
        
         */
    withdraw: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * Permissionless bounded crank. An empty batch advances only the phase
     * clock; each item is idempotent when no transition is due.
     *
     * The A13 collator payout is composed here rather than folded into the
     * benchmarked `tick` number: it fires only on an epoch crossing, and
     * `tick`'s benchmarked worst case is a full batch *without* one, so no
     * single fixture measures both. Charging it unconditionally is the
     * conservative direction — a crossing is only known after dispatch
     * (SQ-490). SQ-499 keeps that pre-charge and refunds this addend only
     * when the payout branch was not taken.
     */
    tick: TxDescriptor<Anonymize<Ifoljaehihf3a6>>;
    /**
     * Charges the A13 collator payout for the same reason `tick` does: this
     * is a clock-syncing entry point, so it can be the crossing's first
     * caller (SQ-490).
     */
    decide: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * Charges the A13 collator payout for the same reason `tick` does: this
     * is a clock-syncing entry point, so it can be the crossing's first
     * caller (SQ-490).
     */
    settle_cohort: TxDescriptor<Anonymize<Ict5mnga93gs4g>>;
    /**
     * META/ConstitutionalValues refresh of the next-boundary epoch length.
     */
    set_next_epoch_length: TxDescriptor<undefined>;
    /**
        
         */
    delay_once: TxDescriptor<Anonymize<If5i6c2m5d9b65>>;
    /**
        
         */
    mark_executed: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
        
         */
    mark_failed_executed: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
        
         */
    retry_exhausted_to_measurement: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
        
         */
    expire_or_stale_queue: TxDescriptor<Anonymize<I9ihjoku7164ou>>;
    /**
        
         */
    force_reject_process_hold: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
        
         */
    void_cohort: TxDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
     * PB-HALT-INTAKE effect endpoint (06 §6.2). Clearing ignores the
     * supplied expiry; setting is bounded independently of guardian state.
     */
    set_intake_paused: TxDescriptor<Anonymize<I6qcvfaiubjt05>>;
    /**
     * 05 §7(6) orphan-epoch Baseline finalization (SQ-320; 03 §5.2).
     *
     * An epoch that opened a Baseline book but never formed a cohort has
     * no producer for its Baseline settlement, so the vault stays `Open`
     * forever, every single-sided holder is stranded, and the book keeps
     * an un-reapable POL commitment. This crank reaches exactly that case
     * — a strictly past, cohort-free, summary-free epoch whose every
     * proposal is terminal across both bounded storage halves
     * (`IntakeProposals` and `Proposals`) — and is a harmless no-op when
     * the vault is absent or already settled (G-1).
     *
     * Permissionless `Signed` per the 06 §3.2 authority matrix, and
     * deliberately unaffected by `PB-LEDGER-FREEZE` (06 §6.3 exempts
     * settlement calls; the freeze's own T20 sweep is one broad way an
     * epoch can be orphaned). Emits no epoch event: the settlement's
     * canonical signal is the ledger's frozen `BaselineSettled` (02 §6).
     */
    finalize_epoch_baseline: TxDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
     * Permissionless crank for the two 07 boundaries the oracle owns and the
     * epoch clock schedules: §4's watchtower liveness sweep at each rollover,
     * and §11(1)'s `OracleSettleDeadline` force-neutralization at d20
     * (SQ-182/SQ-491).
     *
     * A separate call rather than a rider on `tick`/`decide`/`settle_cohort`
     * because both callbacks hydrate the whole bounded oracle aggregate, and
     * 13 §5 pins `decide` at 231,055 B of proof against a 384 KiB ceiling —
     * the aggregate alone measures 356,514 B, so the worst case does not fit
     * inside a per-block crank at all. 07 §11(1) calls this a crank and §13
     * gives the oracle no hooks, so this is also the shape the spec asks for.
     * Idempotent: every leg is a no-op once its boundary has been driven.
     */
    drive_oracle_boundaries: TxDescriptor<undefined>;
    /**
     * Proposer-authorized binding for the CODE/META values referendum.
     * The referendum may still be ongoing; the execution guard records
     * the submitted index separately from the eventual passed
     * `RatificationRecord` (06 §2.2, 09 §1.1(4), SQ-145). Keeping this
     * endpoint on epoch makes the proposer check independent of the
     * guard's internal origin seams and permits a pre-queue binding.
     */
    bind_ratification: TxDescriptor<Anonymize<I7661jqlhbtghb>>;
  };
  ExecutionGuard: {
    /**
     * Permissionless 09 §1.2 execution crank.
     */
    execute: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * Permissionless second phase of the authorized-upgrade flow.
     *
     * `Operational`, matching the `frame_system::apply_authorized_upgrade`
     * this call forwards to. The class is not cosmetic here: it selects
     * which `BlockLength` ceiling `CheckWeight::check_block_length`
     * measures the encoded extrinsic against, and this is the one call
     * that carries a whole runtime image as a single argument. Under
     * `Normal` that ceiling is the runtime's normal-dispatch slice of the
     * block, which sits **below** `MaxRuntimeCodeBytes` — so the top of
     * the bound this same pallet publishes as a frozen constant (02 §9)
     * would be refused in the pool with `ExhaustsResources`: before any
     * dispatch, with no on-chain error and no event, on the one call whose
     * whole purpose is liveness. `frame_system` chose `Operational` for
     * exactly this reason; omitting it here silently narrowed the door.
     * `upgrade_apply_paths_can_carry_max_runtime_code_bytes` in
     * `runtime::pov_budgets` re-derives that relation from both sides
     * rather than restating either number.
     */
    apply_authorized_upgrade: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
    /**
     * T22 keeper crank after the bounded T18 retry window.
     */
    expire_failed_execution: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * Sole ratify-track governance call (06 §2.2/§3.2).
     */
    ratify: TxDescriptor<Anonymize<I7661jqlhbtghb>>;
    /**
     * Permissionless T16 cleanup for a deterministically stale,
     * unratified-at-grace, or revoked-attestation queue entry.
     */
    reject_stale: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * Commit the pre-attested recovery Wasm carried by the same
     * values-ratified CODE/META payload as its primary authorization.
     * The call is useful only inside the guard's transient dispatch
     * context; a bare custom-origin dispatch therefore still fails.
     */
    commit_recovery_image: TxDescriptor<Anonymize<Ic23t0smeuk6mq>>;
    /**
     * One-shot Phase-3→4 bridge. Bootstrap sudo may select only a passed
     * shadow CODE/META mandate; all authorization checks and the sole
     * internal-Root dispatch remain inside the guard (I-10).
     */
    authorize_phase_four: TxDescriptor<Anonymize<If5i6c2m5d9b65>>;
    /**
     * Permissionless, one-image recovery qualification. This operational
     * call is the only healthy-chain path that reads the full recovery
     * Wasm; epoch screening and queue admission consume the immutable
     * cached descriptor with bounded storage proofs.
     */
    qualify_recovery_image: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
  };
  ClientRegistry: {
    /**
     * Admit an exact XCM location and hold the live `svc.client_bond`
     * amount from its nominated local funder.
     */
    admit_client: TxDescriptor<Anonymize<I5h8g89cqhubt3>>;
    /**
     * Admit one exact local signer. The identity account is also the only
     * account the question service may debit for USDC escrow.
     */
    admit_local_client: TxDescriptor<Anonymize<I3gvjatq4m8h18>>;
    /**
     * Close new-question admission immediately. Existing questions retain
     * the origin and bond until the final terminal notification.
     */
    remove_client: TxDescriptor<Anonymize<I8vsdam138s0ak>>;
    /**
     * Move exact USDC from this client's runtime-derived funding account
     * into its deterministic delivery escrow.
     */
    top_up_delivery_float: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Return exact USDC only to the runtime-derived client funder.
     */
    withdraw_delivery_float: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
  };
  QuestionService: {
    /**
     * Register, escrow and create the exact two external books atomically.
     */
    register: TxDescriptor<Anonymize<I68s7org31qt4d>>;
    /**
     * Authenticate and fund one client-named attestor promise.
     */
    bond_attestor: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
    /**
     * Atomically expose both pre-seeded books to trading.
     */
    open: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
    /**
     * Seal both TWAP windows, publish the sold report, resolve the branch,
     * and earn instrument D exactly once.
     */
    seal: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
    /**
     * Store the signed attestor's latest in-window value.
     */
    submit_attestation: TxDescriptor<Anonymize<I7n5sdbabu8l7g>>;
    /**
     * Permissionless successful/failing settlement crank after the frozen
     * report window. Every error path becomes VOID in the same transaction.
     */
    settle: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
    /**
     * Permissionless clock-driven failure crank. For a sealed question it
     * shares the terminalizer with `settle`, so transaction ordering can
     * never VOID a valid quorum.
     */
    void: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
    /**
     * PB-HALT-INTAKE effect: stop new registration/seal work and mark every
     * bounded live question for VOID at its next clock deadline.
     */
    set_paused: TxDescriptor<Anonymize<I1qpch3k96pn83>>;
    /**
     * Remove the external-pair capacity row and service-owned retained rows
     * only after both books and the service-ledger vault completed reaping.
     */
    archive: TxDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
  };
  ServiceLedger: {
    /**
     * 03 §5.1. Split `a` USDC into `a` Accept-USDC + `a` Reject-USDC.
     */
    split: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.1. Burn a complete Accept+Reject pair, pay `a` USDC out (par).
     */
    merge: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.1. Split branch-USDC into a LONG/SHORT scalar set.
     */
    split_scalar: TxDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * 03 §5.1. Merge a LONG/SHORT set back to branch-USDC.
     */
    merge_scalar: TxDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * 03 §5.1. Split branch-USDC into a gate YES/NO set.
     */
    split_gate: TxDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * 03 §5.1. Merge a gate YES/NO set back to branch-USDC.
     */
    merge_gate: TxDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * 03 §5.1. Move `a` of a position to another account. The recipient pays
     * the storage deposit (03 §4); the R-2 remainder sweep applies to Signed
     * senders.
     */
    transfer: TxDescriptor<Anonymize<Ideepm5vhbl12g>>;
    /**
     * 03 §5.1. Baseline split.
     */
    split_baseline: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.1. Baseline merge.
     */
    merge_baseline: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.2. `Open → Resolved(w)` (`ResolveAuthority`, exactly once, I-3).
     */
    resolve: TxDescriptor<Anonymize<I3l1prg489cgso>>;
    /**
     * 03 §5.2. `Open|Resolved → Voided` (`ResolveAuthority`, not from
     * `ScalarSettled`). Records the terminal block for reaping.
     */
    void: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * 03 §5.2. `Resolved(w) → ScalarSettled{w,s}` (`SettleAuthority`).
     */
    settle_scalar: TxDescriptor<Anonymize<I8b0duu38170aj>>;
    /**
     * 03 §5.2. Record a winning-branch gate breach outcome (`SettleAuthority`).
     */
    settle_gate: TxDescriptor<Anonymize<I7445bslhc0ic2>>;
    /**
     * 03 §5.2. Settle a Baseline vault (`SettleAuthority`).
     */
    settle_baseline: TxDescriptor<Anonymize<Id6e8lk3pfjocj>>;
    /**
     * 03 §5.3. Redeem winning branch-USDC 1:1 (`ScalarSettled`).
     */
    redeem: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.3. Redeem a single scalar leg with maker-adverse flooring (B-5).
     */
    redeem_scalar: TxDescriptor<Anonymize<I449ug3537vfu2>>;
    /**
     * 03 §5.3. Redeem a complete LONG+SHORT pair for exactly `a` (no double
     * flooring, R-1).
     */
    redeem_scalar_pair: TxDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * 03 §5.3. Redeem the winning side of a settled gate 1:1.
     */
    redeem_gate: TxDescriptor<Anonymize<I7r9r972bl7s6h>>;
    /**
     * 03 §5.3. VOID redemption: branch-USDC `floor(a/2)`, legs `floor(a/4)`.
     */
    redeem_void: TxDescriptor<Anonymize<I45orgf9ulklgj>>;
    /**
     * 03 §5.3. Redeem a single Baseline leg.
     */
    redeem_baseline: TxDescriptor<Anonymize<I7gp5f34oc7pki>>;
    /**
     * 03 §5.3. Redeem a complete Baseline pair for exactly `a`.
     */
    redeem_baseline_pair: TxDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * 03 §5.4. Keeper crank: drain ≤ `ReapBatch` `Positions` entries of a
     * terminal, archive-elapsed proposal vault, refunding deposits; when fully
     * drained, sweep residual escrow to INSURANCE and remove the vault.
     */
    sweep_dust: TxDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * 03 §5.4. Keeper crank for Baseline vaults.
     */
    sweep_dust_baseline: TxDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
     * PB-RESERVE effect endpoint (06 §6.2). Only public split inflows are
     * gated; every exit/recovery path remains live.
     */
    set_split_paused: TxDescriptor<Anonymize<I6qcvfaiubjt05>>;
    /**
     * PB-LEDGER-FREEZE effect endpoint (06 §6.3). No balances or
     * positions move in this call; it only installs/removes the gate.
     */
    set_frozen: TxDescriptor<Anonymize<I7tjbm7l304tu9>>;
    /**
     * Permissionless O(1) I-4 reconciliation crank (03 §5.4).
     *
     * `TotalEscrowed` is transactionally maintained by every escrow delta;
     * `try_state` independently re-sums the unbounded claimant-retained vault
     * maps. This dispatch therefore never performs an unbounded scan.
     */
    reconcile: TxDescriptor<undefined>;
    /**
     * 03 §5.4 / §5.3a(4). Permissionless O(1) keeper crank: move the whole
     * accrued redemption fee from the sovereign to the treasury `MAIN`
     * account and zero the counter, atomically.
     *
     * A sweep on an **empty** counter is a successful no-op, not an error
     * (I-31; §5.3a(6) introduces no error and the §8 list is frozen). It
     * moves surplus, never escrow: `TotalEscrowed`, every vault's
     * `escrowed` and every supply field are untouched, so it cannot
     * underflow — the counter only ever accumulates amounts already
     * withheld from completed payouts. `Preservation::Preserve` keeps the
     * sovereign above its R-4 permanent floor, which L-7 is what makes
     * safe: the accrual is bounded by the surplus **above** `min_balance`,
     * so the crank can always pay out in full.
     *
     * **Frozen under `PB-LEDGER-FREEZE`** (06 §6.3; SQ-517). L-7 is a
     * conditional, and its condition is the negation of the I-4 drift
     * flag: the bound reads `RedemptionFeesAccrued ≤ balance −
     * TotalEscrowed − held_deposits − min_balance`, while the flag says
     * exactly that `TotalEscrowed + held_deposits > balance` — so under
     * the one state that authorizes a freeze the bound is *negative* and
     * there is no surplus to sweep. "Moves surplus, never escrow" then
     * stops being true, and `Preservation::Preserve` does not rescue it:
     * it protects `min_balance` and is indifferent to escrow. Refusing
     * here is what keeps the paragraph above accurate on every path this
     * crank can actually take.
     */
    sweep_redemption_fees: TxDescriptor<undefined>;
  };
  TradingRewards: {
    /**
     * Hold a USDC bond and open a participant record (08 §2.6).
     *
     * Every refusal precedes every state change, and the `rwd.rate` read
     * is first of all: 08 §2.6's failure behaviour requires an unset rate
     * to fail closed **before any hold**.
     */
    enroll: TxDescriptor<Anonymize<Ialpmgmhr3gk5r>>;
    /**
     * Raise the hold. The earning cap moves only at the next settlement.
     *
     * 08 §2.6: an immediate cap raise would let a wash operator wait for
     * the outcome, enlarge only the winning account's cap, and leave the
     * loser at the minimum. `snapshot_bond` and `snapshot_epoch` are
     * therefore untouched here, unconditionally.
     */
    top_up_bond: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Release the whole bond (08 §2.6).
     *
     * The gate is **epoch settlement**, never folding: folding deletes the
     * last score entry while the debit settles at epoch close, so a
     * fold-based gate would let a participant who folded a losing epoch
     * release the whole bond ahead of the debit.
     *
     * **Settlement is the only condition, per 08 §2.6, and an unclaimed
     * accrual is deliberately not a second one.** An accrual is a VIT
     * claim against a budget that §2.6 returns to the pot at epoch close,
     * so an accrual outstanding past that boundary routinely meets an
     * empty budget — and refusing here would then leave the participant
     * able to neither claim nor withdraw, with the only remedy a
     * `FutarchyParam` call they cannot make. §2.6 separately forbids a
     * bond being locked forever. So the bond always comes back, and the
     * record survives at a zero bond to carry the claim.
     */
    withdraw_bond: TxDescriptor<undefined>;
    /**
     * Convert the accrued USDC figure to VIT once, at the live
     * `fee.vit_usdc_rate`, and pay it from the authorized budget.
     *
     * 08 §2.6: both legs of the reward arithmetic are USDC and only the
     * payout converts, rounding against the claimant. There is no vesting.
     *
     * A claim that empties a record `withdraw_bond` already released also
     * **closes** it and returns its roster slot. That is what keeps the
     * retained-record path from starving [`MAX_PARTICIPANTS`]: the slot is
     * freed by the call the claimant already wants to make, rather than by
     * a second one they might never send.
     */
    claim_rewards: TxDescriptor<undefined>;
    /**
     * Fold one settled market into the account's epoch total and delete
     * the entry (08 §2.6).
     *
     * **Permissionless without qualification, and it names a target rather
     * than the caller.** That is safe because it acts only on
     * already-recorded values: every caller reaches the same result and no
     * caller can choose it. [`Pallet::settle_epoch`] is deliberately
     * *not* in that class — see its own note. The keeper cranks both
     * (01 §4.2).
     *
     * It succeeds on one of exactly two conditions. Either the book has
     * reached a terminal state, in which case rule 3 credits the entry's
     * own `book_acquired` — never a ledger position, which redemption
     * burns at the same instant settlement opens — and rule 4 selects the
     * arm from the branch's disposition; or the **absolute timeout** has
     * elapsed, in which case the entry drops at zero without folding.
     * Settlement is checked
     * first: §2.6 sizes the timeout above the longest lawful settlement
     * horizon precisely so no settling market reaches it, and dropping a
     * settled market would turn the liveness escape into an exit from a
     * live debit.
     */
    settle_market_score: TxDescriptor<Anonymize<I82lmvrrpt0s2n>>;
    /**
     * Close one participant's epoch, applying the reward or the debit
     * exactly once (08 §2.6). It names a target rather than the caller,
     * **but it is not permissionless in the way
     * [`Pallet::settle_market_score`] is, and the difference is the whole
     * point of the fourth refusal below.**
     *
     * The fold acts on already-recorded values, so any caller reaches the
     * same result. This call does not: it clamps the reward to the
     * budget's unpromised remainder **as read at call time** and then
     * resets the epoch unconditionally, so two callers at two moments
     * reach two different results and the earlier one is irreversible —
     * re-funding cannot reopen a settled epoch. A third party could
     * therefore finalise a victim into a zero-headroom moment for the
     * price of a transaction fee, which is the same harm §2.6 forbids for
     * a permissionless budget sweep, reached from the other side.
     *
     * Four obligations §2.6 states normatively, and each is a refusal
     * above rather than a correction below:
     *
     * 1. **Idempotent per participant per epoch.** Settling re-snapshots
     * the record onto the current epoch, so a second call meets the
     * closed-epoch refusal. There is no separate settled marker to keep
     * in step with the snapshot.
     * 2. **Refuses an epoch that has not closed.**
     * 3. **Refuses while an unfolded score entry remains** — otherwise a
     * partially folded account settles on part of its own score, which
     * is the one ordering in which a losing epoch pays a reward.
     * 4. **Refuses a caller other than the participant when the live
     * headroom would clamp the reward below the full entitlement.** The
     * participant may always settle themselves and accept a partial
     * payout, which keeps §2.6's FCFS residual a choice they make
     * rather than one made for them, and a third party may still crank
     * every epoch the clamp does not touch.
     *
     * It also re-snapshots the bond **whenever an epoch closes, including
     * when there was nothing to settle**. Nothing else re-snapshots, so
     * without that an account that tops up in a quiet epoch would keep the
     * smaller cap indefinitely and §2.6's "a top-up takes effect from the
     * next epoch" would not be what the code does (TR3 §6.2).
     */
    settle_epoch: TxDescriptor<Anonymize<I4cbvqmqadhrea>>;
  };
};
type IEvent = {
  System: {
    /**
     * An extrinsic completed successfully.
     */
    ExtrinsicSuccess: PlainDescriptor<Anonymize<Ia82mnkmeo2rhc>>;
    /**
     * An extrinsic failed.
     */
    ExtrinsicFailed: PlainDescriptor<Anonymize<I206k5fm430ncu>>;
    /**
     * `:code` was updated to the code with the given hash.
     */
    CodeUpdated: PlainDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * A new account was created.
     */
    NewAccount: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
    /**
     * An account was reaped.
     */
    KilledAccount: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
    /**
     * On on-chain remark happened.
     */
    Remarked: PlainDescriptor<Anonymize<I855j4i3kr8ko1>>;
    /**
     * An upgrade was authorized.
     */
    UpgradeAuthorized: PlainDescriptor<Anonymize<Ibgl04rn6nbfm6>>;
    /**
     * An invalid authorized upgrade was rejected while trying to apply it.
     */
    RejectedInvalidAuthorizedUpgrade: PlainDescriptor<Anonymize<Ibt374blbobs7t>>;
  };
  ParachainSystem: {
    /**
     * The validation function has been scheduled to apply.
     */
    ValidationFunctionStored: PlainDescriptor<undefined>;
    /**
     * The validation function was applied as of the contained relay chain block number.
     */
    ValidationFunctionApplied: PlainDescriptor<Anonymize<Idd7hd99u0ho0n>>;
    /**
     * The relay-chain aborted the upgrade process.
     */
    ValidationFunctionDiscarded: PlainDescriptor<undefined>;
    /**
     * Some downward messages have been received and will be processed.
     */
    DownwardMessagesReceived: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
    /**
     * Downward messages were processed using the given weight.
     */
    DownwardMessagesProcessed: PlainDescriptor<Anonymize<I100l07kaehdlp>>;
    /**
     * An upward message was sent to the relay chain.
     */
    UpwardMessageSent: PlainDescriptor<Anonymize<I6gnbnvip5vvdi>>;
  };
  Balances: {
    /**
     * An account was created with some free balance.
     */
    Endowed: PlainDescriptor<Anonymize<Icv68aq8841478>>;
    /**
     * An account was removed whose balance was non-zero but below ExistentialDeposit,
     * resulting in an outright loss.
     */
    DustLost: PlainDescriptor<Anonymize<Ic262ibdoec56a>>;
    /**
     * Transfer succeeded.
     */
    Transfer: PlainDescriptor<Anonymize<Iflcfm9b6nlmdd>>;
    /**
     * A balance was set by root.
     */
    BalanceSet: PlainDescriptor<Anonymize<Ijrsf4mnp3eka>>;
    /**
     * Some balance was reserved (moved from free to reserved).
     */
    Reserved: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some balance was unreserved (moved from reserved to free).
     */
    Unreserved: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some balance was moved from the reserve of the first account to the second account.
     * Final argument indicates the destination balance type.
     */
    ReserveRepatriated: PlainDescriptor<Anonymize<I8tjvj9uq4b7hi>>;
    /**
     * Some amount was deposited (e.g. for transaction fees).
     */
    Deposit: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some amount was withdrawn from the account (e.g. for transaction fees).
     */
    Withdraw: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some amount was removed from the account (e.g. for misbehavior).
     */
    Slashed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some amount was minted into an account.
     */
    Minted: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some credit was balanced and added to the TotalIssuance.
     */
    MintedCredit: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Some amount was burned from an account.
     */
    Burned: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some debt has been dropped from the Total Issuance.
     */
    BurnedDebt: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Some amount was suspended from an account (it can be restored later).
     */
    Suspended: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some amount was restored into an account.
     */
    Restored: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * An account was upgraded.
     */
    Upgraded: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
    /**
     * Total issuance was increased by `amount`, creating a credit to be balanced.
     */
    Issued: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Total issuance was decreased by `amount`, creating a debt to be balanced.
     */
    Rescinded: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * Some balance was locked.
     */
    Locked: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some balance was unlocked.
     */
    Unlocked: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some balance was frozen.
     */
    Frozen: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * Some balance was thawed.
     */
    Thawed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * The `TotalIssuance` was forcefully changed.
     */
    TotalIssuanceForced: PlainDescriptor<Anonymize<I4fooe9dun9o0t>>;
    /**
     * Some balance was placed on hold.
     */
    Held: PlainDescriptor<Anonymize<I4ici6vhci5d5f>>;
    /**
     * Held balance was burned from an account.
     */
    BurnedHeld: PlainDescriptor<Anonymize<I4ici6vhci5d5f>>;
    /**
     * A transfer of `amount` on hold from `source` to `dest` was initiated.
     */
    TransferOnHold: PlainDescriptor<Anonymize<I9ia5eeknmnh40>>;
    /**
     * The `transferred` balance is placed on hold at the `dest` account.
     */
    TransferAndHold: PlainDescriptor<Anonymize<I9nrdlsbtsjaoc>>;
    /**
     * Some balance was released from hold.
     */
    Released: PlainDescriptor<Anonymize<I4ici6vhci5d5f>>;
    /**
     * An unexpected/defensive event was triggered.
     */
    Unexpected: PlainDescriptor<Anonymize<Iph9c4rn81ub2>>;
  };
  ForeignAssets: {
    /**
     * Some asset class was created.
     */
    Created: PlainDescriptor<Anonymize<Icqe266pmnr25o>>;
    /**
     * Some assets were issued.
     */
    Issued: PlainDescriptor<Anonymize<I5hoiph0lqphp>>;
    /**
     * Some assets were transferred.
     */
    Transferred: PlainDescriptor<Anonymize<I5k7oropl9ofc7>>;
    /**
     * Some assets were destroyed.
     */
    Burned: PlainDescriptor<Anonymize<I48vagp1omigob>>;
    /**
     * The management team changed.
     */
    TeamChanged: PlainDescriptor<Anonymize<Ib5tst4ppem1g6>>;
    /**
     * The owner changed.
     */
    OwnerChanged: PlainDescriptor<Anonymize<Ibn64edsrg3737>>;
    /**
     * Some account `who` was frozen.
     */
    Frozen: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
    /**
     * Some account `who` was thawed.
     */
    Thawed: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
    /**
     * Some asset `asset_id` was frozen.
     */
    AssetFrozen: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * Some asset `asset_id` was thawed.
     */
    AssetThawed: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * Accounts were destroyed for given asset.
     */
    AccountsDestroyed: PlainDescriptor<Anonymize<I3jnhifvaeuama>>;
    /**
     * Approvals were destroyed for given asset.
     */
    ApprovalsDestroyed: PlainDescriptor<Anonymize<I8n1gia0lo42ok>>;
    /**
     * An asset class is in the process of being destroyed.
     */
    DestructionStarted: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * An asset class was destroyed.
     */
    Destroyed: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * Some asset class was force-created.
     */
    ForceCreated: PlainDescriptor<Anonymize<Ibn64edsrg3737>>;
    /**
     * New metadata has been set for an asset.
     */
    MetadataSet: PlainDescriptor<Anonymize<I6gb0o7lqjfdjq>>;
    /**
     * Metadata has been cleared for an asset.
     */
    MetadataCleared: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * (Additional) funds have been approved for transfer to a destination account.
     */
    ApprovedTransfer: PlainDescriptor<Anonymize<Idh36v6iegkmpq>>;
    /**
     * An approval for account `delegate` was cancelled by `owner`.
     */
    ApprovalCancelled: PlainDescriptor<Anonymize<I27hnueutmchbe>>;
    /**
     * An `amount` was transferred in its entirety from `owner` to `destination` by
     * the approved `delegate`.
     */
    TransferredApproved: PlainDescriptor<Anonymize<Iectm2em66uhao>>;
    /**
     * An asset has had its attributes changed by the `Force` origin.
     */
    AssetStatusChanged: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * The min_balance of an asset has been updated by the asset owner.
     */
    AssetMinBalanceChanged: PlainDescriptor<Anonymize<I7q57goff3j72h>>;
    /**
     * Some account `who` was created with a deposit from `depositor`.
     */
    Touched: PlainDescriptor<Anonymize<Ibe49veu9i9nro>>;
    /**
     * Some account `who` was blocked.
     */
    Blocked: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
    /**
     * Some assets were deposited (e.g. for transaction fees).
     */
    Deposited: PlainDescriptor<Anonymize<I1rnkmiu7usb82>>;
    /**
     * Some assets were withdrawn from the account (e.g. for transaction fees).
     */
    Withdrawn: PlainDescriptor<Anonymize<I1rnkmiu7usb82>>;
    /**
     * Reserve information was set or updated for `asset_id`.
     */
    ReservesUpdated: PlainDescriptor<Anonymize<Ig6jnoe1clkm7>>;
    /**
     * Reserve information was removed for `asset_id`.
     */
    ReservesRemoved: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    /**
     * Some assets were issued as Credit (no owner yet).
     */
    IssuedCredit: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
    /**
     * Some assets Credit was destroyed.
     */
    BurnedCredit: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
    /**
     * Some assets were burned and a Debt was created.
     */
    IssuedDebt: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
    /**
     * Some assets Debt was destroyed (and assets issued).
     */
    BurnedDebt: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
  };
  TransactionPayment: {
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who`.
     */
    TransactionFeePaid: PlainDescriptor<Anonymize<Ier2cke86dqbr2>>;
  };
  AssetTxPayment: {
    /**
     * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
     * has been paid by `who` in an asset `asset_id`.
     */
    AssetTxFeePaid: PlainDescriptor<Anonymize<Iaeqj2ebnvkjqe>>;
  };
  Vesting: {
    /**
     * A vesting schedule has been created.
     */
    VestingCreated: PlainDescriptor<Anonymize<Ih04jp733tqqa>>;
    /**
     * The amount vested has been updated. This could indicate a change in funds available.
     * The balance given is the amount which is left unvested (and thus locked).
     */
    VestingUpdated: PlainDescriptor<Anonymize<Ievr89968437gm>>;
    /**
     * An \[account\] has become fully vested.
     */
    VestingCompleted: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
  };
  Referenda: {
    /**
     * A referendum has been submitted.
     */
    Submitted: PlainDescriptor<Anonymize<I229ijht536qdu>>;
    /**
     * The decision deposit has been placed.
     */
    DecisionDepositPlaced: PlainDescriptor<Anonymize<I62nte77gksm0f>>;
    /**
     * The decision deposit has been refunded.
     */
    DecisionDepositRefunded: PlainDescriptor<Anonymize<I62nte77gksm0f>>;
    /**
     * A deposit has been slashed.
     */
    DepositSlashed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * A referendum has moved into the deciding phase.
     */
    DecisionStarted: PlainDescriptor<Anonymize<I9cg2delv92pvq>>;
    /**
        
         */
    ConfirmStarted: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
        
         */
    ConfirmAborted: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * A referendum has ended its confirmation phase and is ready for approval.
     */
    Confirmed: PlainDescriptor<Anonymize<Ilhp45uime5tp>>;
    /**
     * A referendum has been approved and its proposal has been scheduled.
     */
    Approved: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * A proposal has been rejected by referendum.
     */
    Rejected: PlainDescriptor<Anonymize<Ilhp45uime5tp>>;
    /**
     * A referendum has been timed out without being decided.
     */
    TimedOut: PlainDescriptor<Anonymize<Ilhp45uime5tp>>;
    /**
     * A referendum has been cancelled.
     */
    Cancelled: PlainDescriptor<Anonymize<Ilhp45uime5tp>>;
    /**
     * A referendum has been killed.
     */
    Killed: PlainDescriptor<Anonymize<Ilhp45uime5tp>>;
    /**
     * The submission deposit has been refunded.
     */
    SubmissionDepositRefunded: PlainDescriptor<Anonymize<I62nte77gksm0f>>;
    /**
     * Metadata for a referendum has been set.
     */
    MetadataSet: PlainDescriptor<Anonymize<I4f1hv034jf1dt>>;
    /**
     * Metadata for a referendum has been cleared.
     */
    MetadataCleared: PlainDescriptor<Anonymize<I4f1hv034jf1dt>>;
  };
  ConvictionVoting: {
    /**
     * An account has delegated their vote to another account. \[who, target\]
     */
    Delegated: PlainDescriptor<Anonymize<I7svrbkiu01iec>>;
    /**
     * An \[account\] has cancelled a previous delegation operation.
     */
    Undelegated: PlainDescriptor<Anonymize<I6ouflveob4eli>>;
    /**
     * An account has voted
     */
    Voted: PlainDescriptor<Anonymize<I8cbok7qd7ru4t>>;
    /**
     * A vote has been removed
     */
    VoteRemoved: PlainDescriptor<Anonymize<I8cbok7qd7ru4t>>;
    /**
     * The lockup period of a conviction vote expired, and the funds have been unlocked.
     */
    VoteUnlocked: PlainDescriptor<Anonymize<I7kij8p9kchdjo>>;
  };
  Preimage: {
    /**
     * A preimage has been noted.
     */
    Noted: PlainDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * A preimage has been requested.
     */
    Requested: PlainDescriptor<Anonymize<I1jm8m1rh9e20v>>;
    /**
     * A preimage has ben cleared.
     */
    Cleared: PlainDescriptor<Anonymize<I1jm8m1rh9e20v>>;
  };
  Scheduler: {
    /**
     * Scheduled some task.
     */
    Scheduled: PlainDescriptor<Anonymize<I5n4sebgkfr760>>;
    /**
     * Canceled some task.
     */
    Canceled: PlainDescriptor<Anonymize<I5n4sebgkfr760>>;
    /**
     * Dispatched some task.
     */
    Dispatched: PlainDescriptor<Anonymize<I4o5f4rl7pvbsh>>;
    /**
     * Set a retry configuration for some task.
     */
    RetrySet: PlainDescriptor<Anonymize<Ia3c82eadg79bj>>;
    /**
     * Cancel a retry configuration for some task.
     */
    RetryCancelled: PlainDescriptor<Anonymize<Ienusoeb625ftq>>;
    /**
     * The call for the provided hash was not found so the task has been aborted.
     */
    CallUnavailable: PlainDescriptor<Anonymize<Ienusoeb625ftq>>;
    /**
     * The given task was unable to be renewed since the agenda is full at that block.
     */
    PeriodicFailed: PlainDescriptor<Anonymize<Ienusoeb625ftq>>;
    /**
     * The given task was unable to be retried since the agenda is full at that block or there
     * was not enough weight to reschedule it.
     */
    RetryFailed: PlainDescriptor<Anonymize<Ienusoeb625ftq>>;
    /**
     * The given task can never be executed since it is overweight.
     */
    PermanentlyOverweight: PlainDescriptor<Anonymize<Ienusoeb625ftq>>;
    /**
     * Agenda is incomplete from `when`.
     */
    AgendaIncomplete: PlainDescriptor<Anonymize<Ibtsa3docbr9el>>;
  };
  Utility: {
    /**
     * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
     * well as the error.
     */
    BatchInterrupted: PlainDescriptor<Anonymize<I3r57ai53kj5og>>;
    /**
     * Batch of dispatches completed fully with no error.
     */
    BatchCompleted: PlainDescriptor<undefined>;
    /**
     * Batch of dispatches completed but has errors.
     */
    BatchCompletedWithErrors: PlainDescriptor<undefined>;
    /**
     * A single item within a Batch of dispatches has completed with no error.
     */
    ItemCompleted: PlainDescriptor<undefined>;
    /**
     * A single item within a Batch of dispatches has completed with error.
     */
    ItemFailed: PlainDescriptor<Anonymize<If17b5mo4d2odo>>;
    /**
     * A call was dispatched.
     */
    DispatchedAs: PlainDescriptor<Anonymize<Imnbuc3d6tdsc>>;
    /**
     * Main call was dispatched.
     */
    IfElseMainSuccess: PlainDescriptor<undefined>;
    /**
     * The fallback call was dispatched.
     */
    IfElseFallbackCalled: PlainDescriptor<Anonymize<Ibt0qbob7ghhgn>>;
  };
  Proxy: {
    /**
     * A proxy was executed correctly, with the given.
     */
    ProxyExecuted: PlainDescriptor<Anonymize<Imnbuc3d6tdsc>>;
    /**
     * A pure account has been created by new proxy with given
     * disambiguation index and proxy type.
     */
    PureCreated: PlainDescriptor<Anonymize<Icovh3ggbhth1s>>;
    /**
     * A pure proxy was killed by its spawner.
     */
    PureKilled: PlainDescriptor<Anonymize<I8a8c1n38ann55>>;
    /**
     * An announcement was placed to make a call in the future.
     */
    Announced: PlainDescriptor<Anonymize<I2ur0oeqg495j8>>;
    /**
     * A proxy was added.
     */
    ProxyAdded: PlainDescriptor<Anonymize<I7f2f3co93gefl>>;
    /**
     * A proxy was removed.
     */
    ProxyRemoved: PlainDescriptor<Anonymize<I7f2f3co93gefl>>;
    /**
     * A deposit stored for proxies or announcements was poked / updated.
     */
    DepositPoked: PlainDescriptor<Anonymize<I1bhd210c3phjj>>;
  };
  Multisig: {
    /**
     * A new multisig operation has begun.
     */
    NewMultisig: PlainDescriptor<Anonymize<Iep27ialq4a7o7>>;
    /**
     * A multisig operation has been approved by someone.
     */
    MultisigApproval: PlainDescriptor<Anonymize<Iasu5jvoqr43mv>>;
    /**
     * A multisig operation has been executed.
     */
    MultisigExecuted: PlainDescriptor<Anonymize<I5ank11b0br54o>>;
    /**
     * A multisig operation has been cancelled.
     */
    MultisigCancelled: PlainDescriptor<Anonymize<I5qolde99acmd1>>;
    /**
     * The deposit for a multisig operation has been updated/poked.
     */
    DepositPoked: PlainDescriptor<Anonymize<I8gtde5abn1g9a>>;
  };
  Migrations: {
    /**
     * A Runtime upgrade started.
     *
     * Its end is indicated by `UpgradeCompleted` or `UpgradeFailed`.
     */
    UpgradeStarted: PlainDescriptor<Anonymize<If1co0pilmi7oq>>;
    /**
     * The current runtime upgrade completed.
     *
     * This implies that all of its migrations completed successfully as well.
     */
    UpgradeCompleted: PlainDescriptor<undefined>;
    /**
     * Runtime upgrade failed.
     *
     * This is very bad and will require governance intervention.
     */
    UpgradeFailed: PlainDescriptor<undefined>;
    /**
     * A migration was skipped since it was already executed in the past.
     */
    MigrationSkipped: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
    /**
     * A migration progressed.
     */
    MigrationAdvanced: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
    /**
     * A Migration completed.
     */
    MigrationCompleted: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
    /**
     * A Migration failed.
     *
     * This implies that the whole upgrade failed and governance intervention is required.
     */
    MigrationFailed: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
    /**
     * The set of historical migrations has been cleared.
     */
    HistoricCleared: PlainDescriptor<Anonymize<I3escdojpj0551>>;
  };
  Sudo: {
    /**
     * A sudo call just took place.
     */
    Sudid: PlainDescriptor<Anonymize<I7442cggth99kp>>;
    /**
     * The sudo key has been updated.
     */
    KeyChanged: PlainDescriptor<Anonymize<I5rtkmhm2dng4u>>;
    /**
     * The key was permanently removed.
     */
    KeyRemoved: PlainDescriptor<undefined>;
    /**
     * A [sudo_as](Pallet::sudo_as) call just took place.
     */
    SudoAsDone: PlainDescriptor<Anonymize<I7442cggth99kp>>;
  };
  XcmpQueue: {
    /**
     * An HRMP message was sent to a sibling parachain.
     */
    XcmpMessageSent: PlainDescriptor<Anonymize<I137t1cld92pod>>;
  };
  MessageQueue: {
    /**
     * Message discarded due to an error in the `MessageProcessor` (usually a format error).
     */
    ProcessingFailed: PlainDescriptor<Anonymize<I1rvj4ubaplho0>>;
    /**
     * Message is processed.
     */
    Processed: PlainDescriptor<Anonymize<Ia3uu7lqcc1q1i>>;
    /**
     * Message placed in overweight queue.
     */
    OverweightEnqueued: PlainDescriptor<Anonymize<I7crucfnonitkn>>;
    /**
     * This page was reaped.
     */
    PageReaped: PlainDescriptor<Anonymize<I7tmrp94r9sq4n>>;
  };
  CumulusXcm: {
    /**
     * Downward message is invalid XCM.
     * \[ id \]
     */
    InvalidFormat: PlainDescriptor<SizedHex<32>>;
    /**
     * Downward message is unsupported version of XCM.
     * \[ id \]
     */
    UnsupportedVersion: PlainDescriptor<SizedHex<32>>;
    /**
     * Downward message executed with the given outcome.
     * \[ id, outcome \]
     */
    ExecutedDownward: PlainDescriptor<Anonymize<Ibslgga81p36aa>>;
  };
  PolkadotXcm: {
    /**
     * Execution of an XCM message was attempted.
     */
    Attempted: PlainDescriptor<Anonymize<I61d51nv4cou88>>;
    /**
     * An XCM message was sent.
     */
    Sent: PlainDescriptor<Anonymize<If8u5kl4h8070m>>;
    /**
     * An XCM message failed to send.
     */
    SendFailed: PlainDescriptor<Anonymize<Ibmuil6p3vl83l>>;
    /**
     * An XCM message failed to process.
     */
    ProcessXcmError: PlainDescriptor<Anonymize<I7lul91g50ae87>>;
    /**
     * Query response received which does not match a registered query. This may be because a
     * matching query was never registered, it may be because it is a duplicate response, or
     * because the query timed out.
     */
    UnexpectedResponse: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
    /**
     * Query response has been received and is ready for taking with `take_response`. There is
     * no registered notification call.
     */
    ResponseReady: PlainDescriptor<Anonymize<Iasr6pj6shs0fl>>;
    /**
     * Query response has been received and query is removed. The registered notification has
     * been dispatched and executed successfully.
     */
    Notified: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
    /**
     * Query response has been received and query is removed. The registered notification
     * could not be dispatched because the dispatch weight is greater than the maximum weight
     * originally budgeted by this runtime for the query result.
     */
    NotifyOverweight: PlainDescriptor<Anonymize<Idg69klialbkb8>>;
    /**
     * Query response has been received and query is removed. There was a general error with
     * dispatching the notification call.
     */
    NotifyDispatchError: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
    /**
     * Query response has been received and query is removed. The dispatch was unable to be
     * decoded into a `Call`; this might be due to dispatch function having a signature which
     * is not `(origin, QueryId, Response)`.
     */
    NotifyDecodeFailed: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
    /**
     * Expected query response has been received but the origin location of the response does
     * not match that expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    InvalidResponder: PlainDescriptor<Anonymize<I7r6b7145022pp>>;
    /**
     * Expected query response has been received but the expected origin location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    InvalidResponderVersion: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
    /**
     * Received query response has been read and removed.
     */
    ResponseTaken: PlainDescriptor<Anonymize<I30pg328m00nr3>>;
    /**
     * Some assets have been placed in an asset trap.
     */
    AssetsTrapped: PlainDescriptor<Anonymize<Icmrn7bogp28cs>>;
    /**
     * An XCM version change notification message has been attempted to be sent.
     *
     * The cost of sending it (borne by the chain) is included.
     */
    VersionChangeNotified: PlainDescriptor<Anonymize<I7m9b5plj4h5ot>>;
    /**
     * The supported version of a location has been changed. This might be through an
     * automatic notification or a manual intervention.
     */
    SupportedVersionChanged: PlainDescriptor<Anonymize<I9kt8c221c83ln>>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * sending the notification to it.
     */
    NotifyTargetSendFail: PlainDescriptor<Anonymize<I9onhk772nfs4f>>;
    /**
     * A given location which had a version change subscription was dropped owing to an error
     * migrating the location to our new XCM format.
     */
    NotifyTargetMigrationFail: PlainDescriptor<Anonymize<I3l6bnksrmt56r>>;
    /**
     * Expected query response has been received but the expected querier location placed in
     * storage by this runtime previously cannot be decoded. The query remains registered.
     *
     * This is unexpected (since a location placed in storage in a previously executing
     * runtime should be readable prior to query timeout) and dangerous since the possibly
     * valid response will be dropped. Manual governance intervention is probably going to be
     * needed.
     */
    InvalidQuerierVersion: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
    /**
     * Expected query response has been received but the querier location of the response does
     * not match the expected. The query remains registered for a later, valid, response to
     * be received and acted upon.
     */
    InvalidQuerier: PlainDescriptor<Anonymize<Idh09k0l2pmdcg>>;
    /**
     * A remote has requested XCM version change notification from us and we have honored it.
     * A version information message is sent to them and its cost is included.
     */
    VersionNotifyStarted: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
    /**
     * We have requested that a remote chain send us XCM version change notifications.
     */
    VersionNotifyRequested: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
    /**
     * We have requested that a remote chain stops sending us XCM version change
     * notifications.
     */
    VersionNotifyUnrequested: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
    /**
     * Fees were paid from a location for an operation (often for using `SendXcm`).
     */
    FeesPaid: PlainDescriptor<Anonymize<I512p1n7qt24l8>>;
    /**
     * Some assets have been claimed from an asset trap
     */
    AssetsClaimed: PlainDescriptor<Anonymize<Icmrn7bogp28cs>>;
    /**
     * A XCM version migration finished.
     */
    VersionMigrationFinished: PlainDescriptor<Anonymize<I6s1nbislhk619>>;
    /**
     * An `aliaser` location was authorized by `target` to alias it, authorization valid until
     * `expiry` block number.
     */
    AliasAuthorized: PlainDescriptor<Anonymize<I3gghqnh2mj0is>>;
    /**
     * `target` removed alias authorization for `aliaser`.
     */
    AliasAuthorizationRemoved: PlainDescriptor<Anonymize<I6iv852roh6t3h>>;
    /**
     * `target` removed all alias authorizations.
     */
    AliasesAuthorizationsRemoved: PlainDescriptor<Anonymize<I9oc2o6itbiopq>>;
  };
  CollatorSelection: {
    /**
     * New Invulnerables were set.
     */
    NewInvulnerables: PlainDescriptor<Anonymize<I39t01nnod9109>>;
    /**
     * A new Invulnerable was added.
     */
    InvulnerableAdded: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
    /**
     * An Invulnerable was removed.
     */
    InvulnerableRemoved: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
    /**
     * The number of desired candidates was set.
     */
    NewDesiredCandidates: PlainDescriptor<Anonymize<I1qmtmbe5so8r3>>;
    /**
     * The candidacy bond was set.
     */
    NewCandidacyBond: PlainDescriptor<Anonymize<Ih99m6ehpcar7>>;
    /**
     * A new candidate joined.
     */
    CandidateAdded: PlainDescriptor<Anonymize<Idgorhsbgdq2ap>>;
    /**
     * Bond of a candidate updated.
     */
    CandidateBondUpdated: PlainDescriptor<Anonymize<Idgorhsbgdq2ap>>;
    /**
     * A candidate was removed.
     */
    CandidateRemoved: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
    /**
     * An account was replaced in the candidate list by another one.
     */
    CandidateReplaced: PlainDescriptor<Anonymize<I9ubb2kqevnu6t>>;
    /**
     * An account was unable to be added to the Invulnerables because they did not have keys
     * registered. Other Invulnerables may have been set.
     */
    InvalidInvulnerableSkipped: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
  };
  Session: {
    /**
     * New session has happened. Note that the argument is the session index, not the
     * block number as the type might suggest.
     */
    NewSession: PlainDescriptor<Anonymize<I2hq50pu2kdjpo>>;
    /**
     * The `NewSession` event in the current block also implies a new validator set to be
     * queued.
     */
    NewQueued: PlainDescriptor<undefined>;
    /**
     * Validator has been disabled.
     */
    ValidatorDisabled: PlainDescriptor<Anonymize<I9acqruh7322g2>>;
    /**
     * Validator has been re-enabled.
     */
    ValidatorReenabled: PlainDescriptor<Anonymize<I9acqruh7322g2>>;
  };
  Constitution: {
    /**
     * A 13 §1 key passed its bounds/Δ/cooldown checks and was updated.
     */
    ParamUpdated: PlainDescriptor<Anonymize<Irupv22iu38vu>>;
    /**
     * A capability-table row was inserted or replaced.
     */
    CapabilitySet: PlainDescriptor<Anonymize<I8i1bk7kj5k5ed>>;
    /**
     * A phase-flag bit was set or cleared.
     */
    PhaseFlagSet: PlainDescriptor<Anonymize<Ie5qta40r3ho5l>>;
    /**
     * The D-14 release channel was rewritten.
     */
    ReleaseChannelSet: PlainDescriptor<Anonymize<Ibfd56bn4a7kfk>>;
    /**
     * A registry row's governance metadata was amended (06 §2.1).
     */
    RegistryAmended: PlainDescriptor<Anonymize<Ifcslavva7skj1>>;
    /**
     * A kernel meter was charged within its envelope.
     */
    MeterCharged: PlainDescriptor<Anonymize<Icolandhn4qpus>>;
  };
  ConditionalLedger: {
    /**
     * `split(pid, a)`: minted `a` of both branch-USDC to the caller.
     */
    Split: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `merge(pid, a)`: burned both branch-USDC, paid `a` USDC out.
     */
    Merged: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `split_scalar(pid, b, a)`.
     */
    ScalarSplit: PlainDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * `merge_scalar(pid, b, a)`.
     */
    ScalarMerged: PlainDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * `split_gate(pid, b, g, a)`.
     */
    GateSplit: PlainDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * `merge_gate(pid, b, g, a)`.
     */
    GateMerged: PlainDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * `transfer(position, to, a)`.
     */
    PositionTransferred: PlainDescriptor<Anonymize<I333ps8sjf4lhr>>;
    /**
     * `split_baseline(epoch, a)`.
     */
    BaselineSplit: PlainDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * `merge_baseline(epoch, a)`.
     */
    BaselineMerged: PlainDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * `resolve(pid, w)` — winning branch (02 §6).
     */
    VaultResolved: PlainDescriptor<Anonymize<Iah5vhnso7uqce>>;
    /**
     * `void(pid)` (02 §6, D-1/X-11f).
     */
    VaultVoided: PlainDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * `settle_scalar(pid, s)` — carries the winning branch (02 §6, B-low).
     */
    ScalarSettlementSet: PlainDescriptor<Anonymize<I2lct6m7k5r2et>>;
    /**
     * `settle_gate(pid, g, outcome)` — winning-branch breach outcome (02 §6, B-2).
     */
    GateSettled: PlainDescriptor<Anonymize<I9cf6so4vur6mg>>;
    /**
     * `settle_baseline(epoch, s)`.
     */
    BaselineSettled: PlainDescriptor<Anonymize<Id6e8lk3pfjocj>>;
    /**
     * `redeem(pid, a)` — the par leg, **fee-exempt** (03 §5.3a(1), G-3), so
     * it deliberately carries no `fee` field (02 §6 rule 3).
     */
    Redeemed: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `redeem_scalar(pid, kind, a)` — `payout` is the post-rounding
     * **gross**, `fee` the 03 §5.3a deduction, so `net = payout − fee`
     * (02 §6 rule 1, contract v17).
     */
    ScalarRedeemed: PlainDescriptor<Anonymize<Isntabb3i2t9f>>;
    /**
     * `redeem_scalar_pair(pid, a)` (02 §6, B-5) — `amount` is exactly `a`
     * gross; `fee` is `fee_pair(a)` per 03 §5.3a(2a), **not** `fee(a)`.
     */
    ScalarPairRedeemed: PlainDescriptor<Anonymize<I40af445fa06rh>>;
    /**
     * `redeem_gate(pid, g, a)` — `amount` gross, `fee` the deduction.
     */
    GateRedeemed: PlainDescriptor<Anonymize<Iapmmsuq8j9rcn>>;
    /**
     * `redeem_void(pid, kind, a)` (02 §6, D-1) — `amount` burned, `payout`
     * paid. **Fee-exempt** (03 §5.3a(1)), so no `fee` field (rule 3).
     */
    VoidRedeemed: PlainDescriptor<Anonymize<I80dirtbv2ognl>>;
    /**
     * `redeem_baseline*` — `payout` gross, `fee` the deduction.
     */
    BaselineRedeemed: PlainDescriptor<Anonymize<I6qrovovkeah6g>>;
    /**
     * `sweep_redemption_fees()` moved the accrued balance to the treasury
     * `MAIN` account and zeroed the counter (02 §6, contract v17; 03 §5.4).
     * A sweep on an empty counter is a successful no-op and still emits,
     * with `amount = 0`.
     */
    RedemptionFeesSwept: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * `sweep_dust(pid)` completed — residual escrow swept to INSURANCE (02 §6).
     */
    VaultReaped: PlainDescriptor<Anonymize<I5v7n6l8j8vd1f>>;
    /**
     * `sweep_dust_baseline(epoch)` completed.
     */
    BaselineVaultReaped: PlainDescriptor<Anonymize<I2kpgolvhr6ftt>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    SplitPauseSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    SplitPauseCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeExtended: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * The reconciliation crank crossed from healthy to undercollateralized.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    LedgerDriftDetected: PlainDescriptor<Anonymize<Id2312c48f17dd>>;
    /**
     * The reconciliation crank crossed from undercollateralized to healthy.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    LedgerDriftCleared: PlainDescriptor<Anonymize<Id2312c48f17dd>>;
  };
  Market: {
    /**
     * Frozen 02 §5 trade event.
     */
    Traded: PlainDescriptor<Anonymize<I7a6s4h48lmk1t>>;
    /**
     * Frozen 02 §5 observation event.
     */
    Observed: PlainDescriptor<Anonymize<I2fkgb649u353b>>;
    /**
     * Frozen 02 §5 creation event.
     */
    MarketCreated: PlainDescriptor<Anonymize<I3a053sft19jid>>;
    /**
     * Frozen 02 §5 close event.
     */
    MarketClosed: PlainDescriptor<Anonymize<Ico0ou8pmf1cq5>>;
    /**
     * Frozen 02 §5 reap event.
     */
    MarketReaped: PlainDescriptor<Anonymize<Ico0ou8pmf1cq5>>;
    /**
     * Append-only operational event; not part of the frozen §5 ingest set.
     */
    Seeded: PlainDescriptor<Anonymize<Idj8pac8q2ngco>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    CreationFreezeSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    CreationFreezeCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeExtended: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Frozen 02 §5 sweep event (contract v17). Both amounts are real USDC
     * and either MAY be zero; exactly one exists per market, because the
     * swept marker makes a repeat run a silent no-op (04 §2/§11).
     *
     * Appended rather than grouped with the other §5 rows above: 02 §13
     * makes contract additions append-only, and inserting a variant would
     * renumber every SCALE discriminant after it.
     */
    RevenueSwept: PlainDescriptor<Anonymize<I2sg7pchi235m2>>;
    /**
     * External counterpart. It deliberately does not reuse
     * `RevenueSwept.pol_returned`, whose frozen field means treasury POL.
     * Trading fees remain service revenue in `MAIN`; only the client
     * subsidy is returned here (04 §3; 16 §7.3–§7.4).
     */
    ExternalRevenueSwept: PlainDescriptor<Anonymize<Ibg0qukn7q6t5u>>;
  };
  Welfare: {
    /**
        
         */
    MetricSpecRegistered: PlainDescriptor<Anonymize<I6s1nbislhk619>>;
    /**
        
         */
    SnapshotRecorded: PlainDescriptor<Anonymize<I93sj8arfs7e7f>>;
    /**
        
         */
    GateBreachRecorded: PlainDescriptor<Anonymize<I3qf57dn94jogo>>;
    /**
        
         */
    SettlementComputed: PlainDescriptor<Anonymize<I7jnda8be156fb>>;
    /**
     * 07 §10: this cohort's `W` was recomputed without `dropped` — flagged
     * in two consecutive epochs of its measurement window — with the
     * surviving weights renormalized. Emitted immediately before
     * `SettlementComputed`, so a score that is not the geometric mean of
     * the two published `Snapshots.welfare` values always says why.
     */
    SettlementRenormalized: PlainDescriptor<Anonymize<I27lb9t574io60>>;
    /**
     * One qualifying 05 §4.3.2 defensive-path failure was counted into
     * `Π`'s window accumulator.
     *
     * Emitted on **every** increment, deliberately. An integrity failure
     * that surfaces only as a lower welfare score two cranks later is
     * unactionable: operators need to know which fault class fired, in
     * which window, and how many have accumulated — the fourth zeroes `Π`
     * (12 §6.3). Off the 02 §6 ingest set by that section's (a)–(c) rule
     * (an operator/monitoring diagnostic), so it carries no contract bump.
     */
    IntegrityFailureRecorded: PlainDescriptor<Anonymize<Ic7t67gl6oo8ed>>;
  };
  Oracle: {
    /**
     * A reporter registered with `orc.reporter_stake` held (07 §3).
     */
    ReporterRegistered: PlainDescriptor<Anonymize<Ifaori90nvndr0>>;
    /**
     * A round-1 report was posted with its value-scaled bond (07 §5.1).
     */
    Reported: PlainDescriptor<Anonymize<Ie2rqjbtm23ftk>>;
    /**
     * A challenge was posted, superseding the quorum requirement (07 §5.2).
     */
    Challenged: PlainDescriptor<Anonymize<I7oiv62sj2f3r3>>;
    /**
     * A challenged round escalated; bonds doubled (07 §5.3/§6.2).
     */
    RoundEscalated: PlainDescriptor<Anonymize<I4oohlti0ugomv>>;
    /**
     * A round was resolved mechanically from committed evidence (07 §9).
     */
    RecomputeProven: PlainDescriptor<Anonymize<Icj2jtt996rgo7>>;
    /**
     * A round-3 dispute was escalated to the `OracleResolution` track (07 §5.4).
     */
    AdjudicationRequested: PlainDescriptor<Anonymize<I55162di4jv6rk>>;
    /**
     * The values track adjudicated a terminal dispute (07 §5.4).
     */
    Adjudicated: PlainDescriptor<Anonymize<Ib8h08jrok1svd>>;
    /**
     * A component value settled and is final for money (07 §5; I-18).
     */
    ComponentSettled: PlainDescriptor<Anonymize<I4m6m36nu8gsqu>>;
    /**
     * A component took the neutral path, carrying its last valid value (07 §10).
     */
    NeutralSettlement: PlainDescriptor<Anonymize<Ie1dicjiiaa5q8>>;
    /**
     * A watchtower acknowledged a round as observable (07 §4).
     */
    WindowAcknowledged: PlainDescriptor<Anonymize<I239j3gnc1jsps>>;
    /**
     * The single 48 h quorum extension fired (07 §4).
     */
    WindowExtended: PlainDescriptor<Anonymize<I15atr7h39m6es>>;
    /**
     * No challenge and no quorum after the extension ⇒ neutral (07 §4).
     */
    QuorumFailed: PlainDescriptor<Anonymize<I5052qcfs60vjm>>;
    /**
     * A reporter's bond stack was slashed on a second offense (07 §3/§5.5).
     */
    ReporterSlashed: PlainDescriptor<Anonymize<If8en01tuc3bij>>;
    /**
     * A reporter was ejected on the third offense (07 §3).
     */
    ReporterEjected: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
    /**
     * A watchtower registered with `wt.stake` held (07 §4).
     */
    WatchtowerRegistered: PlainDescriptor<Anonymize<Ifaori90nvndr0>>;
    /**
     * A watchtower was marked inactive for an epoch (07 §4).
     */
    WatchtowerInactive: PlainDescriptor<Anonymize<I5euu4q9kmp9c3>>;
    /**
     * A watchtower's stake was slashed for liveness failure (07 §4).
     */
    WatchtowerSlashed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
    /**
     * A reserve-transferability probe was sent (07 §8).
     */
    ReserveProbeSent: PlainDescriptor<Anonymize<I30pg328m00nr3>>;
    /**
     * A probe outcome was recorded (07 §8).
     */
    ReserveProbeResult: PlainDescriptor<Anonymize<Ictvl5d049lms3>>;
    /**
     * The reserve entered the unhealthy fail-static state (07 §8).
     */
    ReserveUnhealthy: PlainDescriptor<undefined>;
    /**
     * The reserve recovered after `res.recover_threshold` passes (07 §8).
     */
    ReserveRecovered: PlainDescriptor<undefined>;
    /**
     * A retained round's 07 §11(1) retention window closed with no terminal
     * verdict: both bond stacks were refunded to their posters and the
     * round reaped (SQ-492). Appended last so no earlier variant's SCALE
     * discriminant moves.
     */
    RetentionExpired: PlainDescriptor<Anonymize<I94jeskiehjtf1>>;
    /**
     * The retained 07 §3 record store was full of ejections and a
     * departing or ejected account's record could not be kept
     * (contract v19). Fails **open** by design (G-1): a full table must
     * never abort a values-track verdict.
     *
     * An operational diagnostic — off the frozen 02 §6 ingest set by that
     * section's (a)–(c) rule. Appended last.
     */
    ReporterRecordsFull: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
  };
  IncidentRegistry: {
    /**
     * `file` on the Incident instance (07 §7).
     */
    IncidentFiled: PlainDescriptor<Anonymize<I36oknt2f8tl4g>>;
    /**
     * `file` on the Milestone instance (07 §7).
     */
    MilestoneFiled: PlainDescriptor<Anonymize<I288nkd84a7m9u>>;
    /**
     * `challenge_filing` on the Incident instance (07 §7).
     */
    IncidentChallenged: PlainDescriptor<Anonymize<Ifc75td2ivg90e>>;
    /**
     * `challenge_filing` on the Milestone instance (07 §7).
     */
    MilestoneChallenged: PlainDescriptor<Anonymize<Ifc75td2ivg90e>>;
    /**
     * An Incident filing closed as upheld (07 §7).
     */
    IncidentUpheld: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * An Incident filing closed as rejected (07 §7).
     */
    IncidentRejected: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A Milestone filing closed as accepted (07 §7).
     */
    MilestoneAccepted: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A Milestone filing closed as rejected (07 §7).
     */
    MilestoneRejected: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A challenge resolved: the loser's bond was slashed 40 / 60 (07 §5.5/§7).
     */
    FilingBondSlashed: PlainDescriptor<Anonymize<I7i7gk545r3sv3>>;
    /**
     * `close_epoch` derived the aggregate for one `(epoch, frozen version)`
     * and handed it to welfare (07 §7). `spec_version` is a **trailing**
     * field added in contract v14 (02 §6/§13, SQ-141): one epoch closes once
     * per live version, so the pair identifies the record. The ten other
     * registry events are unchanged — filing-id allocation stays per-epoch
     * precisely so `(epoch, filing_id)` remains unique.
     */
    RegistryEpochClosed: PlainDescriptor<Anonymize<I97i24r5tc4i6u>>;
    /**
     * A bonded watchtower acknowledged a registry filing window.
     */
    WindowAcknowledged: PlainDescriptor<Anonymize<I5tek56pm6maiv>>;
    /**
     * A registry filing received its single quorum-failure extension.
     */
    WindowExtended: PlainDescriptor<Anonymize<I60fhenaqhrkjj>>;
  };
  MilestoneRegistry: {
    /**
     * `file` on the Incident instance (07 §7).
     */
    IncidentFiled: PlainDescriptor<Anonymize<I36oknt2f8tl4g>>;
    /**
     * `file` on the Milestone instance (07 §7).
     */
    MilestoneFiled: PlainDescriptor<Anonymize<I288nkd84a7m9u>>;
    /**
     * `challenge_filing` on the Incident instance (07 §7).
     */
    IncidentChallenged: PlainDescriptor<Anonymize<Ifc75td2ivg90e>>;
    /**
     * `challenge_filing` on the Milestone instance (07 §7).
     */
    MilestoneChallenged: PlainDescriptor<Anonymize<Ifc75td2ivg90e>>;
    /**
     * An Incident filing closed as upheld (07 §7).
     */
    IncidentUpheld: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * An Incident filing closed as rejected (07 §7).
     */
    IncidentRejected: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A Milestone filing closed as accepted (07 §7).
     */
    MilestoneAccepted: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A Milestone filing closed as rejected (07 §7).
     */
    MilestoneRejected: PlainDescriptor<Anonymize<I1mjueefcqgdaj>>;
    /**
     * A challenge resolved: the loser's bond was slashed 40 / 60 (07 §5.5/§7).
     */
    FilingBondSlashed: PlainDescriptor<Anonymize<I7i7gk545r3sv3>>;
    /**
     * `close_epoch` derived the aggregate for one `(epoch, frozen version)`
     * and handed it to welfare (07 §7). `spec_version` is a **trailing**
     * field added in contract v14 (02 §6/§13, SQ-141): one epoch closes once
     * per live version, so the pair identifies the record. The ten other
     * registry events are unchanged — filing-id allocation stays per-epoch
     * precisely so `(epoch, filing_id)` remains unique.
     */
    RegistryEpochClosed: PlainDescriptor<Anonymize<I97i24r5tc4i6u>>;
    /**
     * A bonded watchtower acknowledged a registry filing window.
     */
    WindowAcknowledged: PlainDescriptor<Anonymize<I5tek56pm6maiv>>;
    /**
     * A registry filing received its single quorum-failure extension.
     */
    WindowExtended: PlainDescriptor<Anonymize<I60fhenaqhrkjj>>;
  };
  FutarchyTreasury: {
    /**
     * A direct in-cap grant paid from a budget line (08 §1.3).
     */
    Spent: PlainDescriptor<Anonymize<I5l0jsir5si80s>>;
    /**
     * A vesting stream was opened (grant > `trs.stream_threshold`).
     */
    StreamOpened: PlainDescriptor<Anonymize<I6o7guvg1i99i2>>;
    /**
     * A recipient claimed vested funds from a stream.
     */
    StreamClaimed: PlainDescriptor<Anonymize<I5l6c62egasn2e>>;
    /**
     * A TREASURY decision cancelled a stream; the remainder reverts to `MAIN`.
     */
    StreamCancelled: PlainDescriptor<Anonymize<I3qv7v9gggggd4>>;
    /**
     * A budget line was funded from `MAIN` (08 §1.1).
     */
    BudgetLineFunded: PlainDescriptor<Anonymize<I5c87v6pd2sdaf>>;
    /**
     * VIT was minted within the `iss.inflation_cap` window (08 §2.3).
     */
    VitIssued: PlainDescriptor<Anonymize<I7dq91mkderm2o>>;
    /**
     * The reserve-health flag `R` transitioned (08 §1.2, 07 §8).
     */
    NavHaircutFlagged: PlainDescriptor<Anonymize<Ie2mt3ul73mn1d>>;
    /**
     * Mistakenly-sent foreign assets were recovered (TREASURY-only, 08 §1.3).
     */
    ForeignRecovered: PlainDescriptor<Anonymize<I3dg8tbt6tcck6>>;
    /**
     * A coretime renewal was paid from `ops.coretime` (09 §4, dead-man exempt).
     */
    CoretimeRenewalCalled: PlainDescriptor<Anonymize<I5c87v6pd2sdaf>>;
    /**
     * One bounded reserve-probe fee envelope was reserved (07 §8, SQ-114).
     */
    ReserveProbeFeeCharged: PlainDescriptor<Anonymize<I5c87v6pd2sdaf>>;
    /**
     * A class-arming attempt failed the minimum-viable-NAV floor (08 §4.2, loud).
     */
    NavFloorUnmet: PlainDescriptor<Anonymize<I50qqth3sk471t>>;
    /**
     * The metered keeper budget passed 80% (08 §6.3).
     */
    KeeperBudgetLow: PlainDescriptor<Anonymize<I5em265vo8vck5>>;
    /**
     * The metered keeper budget is exhausted (08 §6.3).
     */
    KeeperBudgetExhausted: PlainDescriptor<Anonymize<Ibp2vba0704net>>;
    /**
     * An authenticated Coretime renewal quote was noted or superseded.
     */
    CoretimeQuoteNoted: PlainDescriptor<Anonymize<I4gj9mv93je4sv>>;
    /**
     * An open Coretime quote was pruned.
     */
    CoretimeQuotePruned: PlainDescriptor<Anonymize<Ibnicuotj4pjfm>>;
    /**
     * Treasury governance rotated the quote authority and renewal account.
     */
    CoretimeAuthoritySet: PlainDescriptor<Anonymize<I3f8ncpioik5na>>;
    /**
     * INSURANCE was swept into `MAIN` by a TREASURY decision (08 §1.2/§1.4).
     */
    InsuranceSwept: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * INSURANCE held USDC above its derived target `T_ins` and the surplus
     * overflowed to `MAIN` (08 §1.2) — automatically inside the inflow's own
     * transaction, or through the permissionless reconciliation crank for
     * balance that arrived by direct transfer. Treasury-owned operational
     * history, outside the frozen 02 §6 ingest set, exactly like
     * `PolCustodyMoved` and the two keeper-budget events.
     */
    InsuranceOverflowed: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * A subsidy line moved with its custody: `spent` on a book seed,
     * cleared on the 04 §2 Sweep return (08 §8 step 5; I-33). Treasury-owned
     * operational history, outside the frozen 02 §6 ingest set; it is the
     * POL revolving-balance gauge's series.
     */
    PolCustodyMoved: PlainDescriptor<Anonymize<Idts26aojvm4gr>>;
    /**
     * A bounded Phase-4 community tranche was transferred into an SDK
     * vesting schedule. This is treasury-owned operational history, not a
     * frozen integration-contract event.
     */
    CommunityScheduleCreated: PlainDescriptor<Anonymize<I141piq296rc2n>>;
    /**
     * A bounded Phase 3-4 trading-reward epoch budget was authorized
     * from the `incentiv` pot into the reward pallet's own sovereign
     * account (08 §1.4/§2.6). `remaining` is the pot's undistributed
     * allocation after the debit. This is the frozen event 08 §1.4
     * names for `fund_trading_rewards`.
     */
    TradingRewardsFunded: PlainDescriptor<Anonymize<I3a4qht3l7q9rt>>;
    /**
     * The previous authorization's unspent VIT was returned from the
     * reward pallet's sovereign account to the `incentiv` pot, inside
     * `fund_trading_rewards` and before the new authorization
     * (08 §2.6: *"The return of unspent budget carries the same
     * authority as the authorization"*). `amount` excludes every VIT
     * backing an accrual no participant has claimed yet; `remaining` is
     * the pot's undistributed allocation after the credit and before the
     * new debit. Treasury-owned operational history, not a frozen
     * integration-contract event — 08 §1.4 names no event for the
     * return leg.
     */
    TradingRewardBudgetReturned: PlainDescriptor<Anonymize<I3a4qht3l7q9rt>>;
  };
  Guardian: {
    /**
     * A 5-of-7 action dispatched (06 §5.4).
     */
    GuardianAction: PlainDescriptor<Anonymize<Iasl7n2tkle090>>;
    /**
     * A `force_rerun` reopened a proposal's books (06 §5.3).
     */
    ForceRerun: PlainDescriptor<Anonymize<I178uj1s35amp3>>;
    /**
     * A playbook was activated on a live trigger (06 §6.2).
     */
    PlaybookActivated: PlainDescriptor<Anonymize<Iai5mccr300imn>>;
    /**
     * `PB-LEDGER-FREEZE` renewed once via a values referendum (06 §6.3).
     */
    PlaybookRenewed: PlainDescriptor<Anonymize<I4m6dhgb2ar055>>;
    /**
     * A playbook expired and its effects reverted (06 §6.2).
     */
    PlaybookExpired: PlainDescriptor<Anonymize<I4m6dhgb2ar055>>;
    /**
     * A retrospective review was scheduled on the `ratify` track (06 §5.4);
     * `referendum` is the index returned by [`Config::ReviewScheduler`].
     */
    ReviewScheduled: PlainDescriptor<Anonymize<I1uen92pl1lhqu>>;
    /**
     * The council membership was (re)elected (06 §5.1).
     */
    MembersSet: PlainDescriptor<Anonymize<I3ajpo6bheav6q>>;
    /**
     * A member proposed an action (06 §5.1).
     */
    ActionProposed: PlainDescriptor<Anonymize<Id6ktlm8uq63g6>>;
    /**
     * A member approved an action (06 §5.1).
     */
    ActionApproved: PlainDescriptor<Anonymize<I4f2hva90hak3m>>;
    /**
     * A retrospective review passed and was ratified (06 §5.4).
     */
    ActionRatified: PlainDescriptor<Anonymize<I823eg09r939h3>>;
    /**
     * A review missed its deadline: each approver slashed 50% (06 §5.4).
     */
    ReviewFailed: PlainDescriptor<Anonymize<Ibcj87mgvuqbc8>>;
    /**
     * A recall referendum was auto-scheduled on the `guardian` track for a
     * failed review (06 §5.4); `referendum` is the index returned by
     * [`Config::RecallScheduler`].
     */
    RecallScheduled: PlainDescriptor<Anonymize<I1uen92pl1lhqu>>;
    /**
     * A guardian-track recall enacted; listed approvers' seats are vacant.
     */
    RecallEnacted: PlainDescriptor<Anonymize<I5d87nqeditd0c>>;
    /**
     * Guardian-track availability toggle for an enumerated playbook.
     */
    PlaybookRegistrationSet: PlainDescriptor<Anonymize<I8m9idjg76ip7q>>;
  };
  Attestor: {
    /**
     * Registry members were replaced by the values track.
     */
    MembersSet: PlainDescriptor<Anonymize<I3c63j6sh3evqn>>;
    /**
     * A bonded member submitted an artifact attestation.
     */
    AttestationSubmitted: PlainDescriptor<Anonymize<Ib4lvahglmvoj4>>;
    /**
     * Anyone opened a bonded challenge inside the window.
     */
    AttestationChallenged: PlainDescriptor<Anonymize<Ib5tkqghj5b2lj>>;
    /**
     * The ratify track resolved a challenge and slashed its loser.
     */
    ChallengeResolved: PlainDescriptor<Anonymize<I6d3ckosptflrl>>;
    /**
     * An attestor reached the second-false-attestation ejection threshold.
     */
    AttestorEjected: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
    /**
     * A values-authorized cause removed an attestor from the active roster.
     */
    AttestorRemovedForCause: PlainDescriptor<Anonymize<I4uk5nmqsi401j>>;
    /**
     * A record was durably revoked by a cause-aware removal/ejection.
     */
    AttestationRevoked: PlainDescriptor<Anonymize<I3if4k84v5n0f6>>;
  };
  Epoch: {
    /**
        
         */
    ProposalSubmitted: PlainDescriptor<bigint>;
    /**
        
         */
    ProposalWithdrawn: PlainDescriptor<bigint>;
    /**
        
         */
    ScreeningStarted: PlainDescriptor<bigint>;
    /**
        
         */
    ProposalCancelled: PlainDescriptor<Anonymize<I5k37qbr3s9v15>>;
    /**
        
         */
    ProposalQualified: PlainDescriptor<bigint>;
    /**
        
         */
    ProposalDeferred: PlainDescriptor<bigint>;
    /**
        
         */
    SlotsShrunk: PlainDescriptor<Anonymize<I5eol3g6qqti18>>;
    /**
        
         */
    MarketsOpened: PlainDescriptor<bigint>;
    /**
        
         */
    DecisionExtended: PlainDescriptor<bigint>;
    /**
        
         */
    ProposalQueued: PlainDescriptor<Anonymize<I1qrnckffb9nrm>>;
    /**
        
         */
    ProposalRejected: PlainDescriptor<Anonymize<I5k37qbr3s9v15>>;
    /**
        
         */
    ProposalDelayed: PlainDescriptor<Anonymize<If5i6c2m5d9b65>>;
    /**
        
         */
    RerunScheduled: PlainDescriptor<bigint>;
    /**
        
         */
    RerunOpened: PlainDescriptor<bigint>;
    /**
        
         */
    MandateExpired: PlainDescriptor<bigint>;
    /**
        
         */
    MeasurementStarted: PlainDescriptor<Anonymize<I1e0oh3bn9igat>>;
    /**
        
         */
    CohortSettled: PlainDescriptor<Anonymize<Id6e8lk3pfjocj>>;
    /**
        
         */
    CohortVoided: PlainDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
        
         */
    BaselineCarried: PlainDescriptor<Anonymize<I70l5rhpgblmim>>;
    /**
        
         */
    ProposalForceRejected: PlainDescriptor<Anonymize<I5k37qbr3s9v15>>;
    /**
        
         */
    IntakeSlashed: PlainDescriptor<Anonymize<Id94b4a7r8bjeq>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    IntakePauseSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    IntakePauseCleared: PlainDescriptor<undefined>;
    /**
     * A completed gate window lacked a committed observation and now
     * admits PB-ORACLE-VOID for exactly this cohort.
     * Operational diagnostic outside the frozen 02 ingest schema.
     */
    OracleDeadlockLatched: PlainDescriptor<Anonymize<I36p2bgnnl36ta>>;
    /**
     * The target latch was consumed by cohort VOID or cleared after late
     * observations restored the settlement input.
     * Operational diagnostic outside the frozen 02 ingest schema.
     */
    OracleDeadlockCleared: PlainDescriptor<Anonymize<I36p2bgnnl36ta>>;
  };
  ExecutionGuard: {
    /**
        
         */
    Executed: PlainDescriptor<Anonymize<Ic4vbg4dnnpegu>>;
    /**
        
         */
    ExecutionFailed: PlainDescriptor<Anonymize<I7nl4maqn6m365>>;
    /**
        
         */
    Ratified: PlainDescriptor<Anonymize<I7661jqlhbtghb>>;
    /**
        
         */
    UpgradeAuthorized: PlainDescriptor<Anonymize<I6bq7cmd37a5ik>>;
    /**
        
         */
    Enqueued: PlainDescriptor<Anonymize<I9i68vrjhvjnp1>>;
    /**
        
         */
    Rejected: PlainDescriptor<Anonymize<I5k37qbr3s9v15>>;
    /**
        
         */
    UpgradeApplied: PlainDescriptor<Anonymize<Icu71ht824icnq>>;
    /**
        
         */
    PreimageUnpinned: PlainDescriptor<Anonymize<I3fr1hdlq8g81s>>;
    /**
        
         */
    UpgradeAborted: PlainDescriptor<Anonymize<Ib51vk42m1po4n>>;
    /**
     * Defensive alarm: the exact queue mirror failed. `fail_static` says
     * whether the adapter successfully forced spendable NAV to zero.
     */
    PendingOutflowSyncFailed: PlainDescriptor<Anonymize<I1c5ncj72v7k27>>;
    /**
     * PB-MIGRATION machine-trigger diagnostic (09 §3.2(4)): emitted on the
     * first activation of a migration halt source (failed step, stall,
     * applied-code mismatch, or failed abort cleanup). `cursor` carries the
     * SDK cursor's exact bytes (empty for a source-less halt); `failed_step`
     * is the SDK-reported step index. This is an operator/monitoring
     * diagnostic (12 §6.3, RB-UPGRADE),
     * **outside** the frozen 02 §6 ingest set by that section's (a)-(c) rule
     * — the same off-contract class as `PendingOutflowSyncFailed`, so it
     * carries no `INTEGRATION_CONTRACT_VERSION` bump.
     */
    MigrationHalted: PlainDescriptor<Anonymize<Idhhlivifn563e>>;
    /**
        
         */
    RecoveryImageCommitted: PlainDescriptor<Anonymize<I3o9sh4pms1jcb>>;
    /**
        
         */
    RecoveryImageApplied: PlainDescriptor<Anonymize<Iij42ed7fk1sg>>;
    /**
        
         */
    PhaseFourUpgradeAuthorized: PlainDescriptor<Anonymize<I8vg1ab5ssn90l>>;
    /**
        
         */
    RecoveryImageQualified: PlainDescriptor<Anonymize<Ifai7amejetiv>>;
  };
  ClientRegistry: {
    /**
        
         */
    ClientAdmitted: PlainDescriptor<Anonymize<I5el2hvlofnvv5>>;
    /**
        
         */
    LocalClientAdmitted: PlainDescriptor<Anonymize<Ibqi69m3s38lo0>>;
    /**
        
         */
    ClientRemovalStarted: PlainDescriptor<Anonymize<I6ctvd5gvtboll>>;
    /**
        
         */
    ClientRemoved: PlainDescriptor<Anonymize<Ierkp6g0vn9ojj>>;
    /**
        
         */
    EgressPrepaid: PlainDescriptor<Anonymize<I1srp17os6n92p>>;
    /**
        
         */
    DeliveryFloatToppedUp: PlainDescriptor<Anonymize<I1hd2l2dfhk11i>>;
    /**
        
         */
    DeliveryFloatWithdrawn: PlainDescriptor<Anonymize<I1hd2l2dfhk11i>>;
  };
  QuestionService: {
    /**
        
         */
    QuestionRegistered: PlainDescriptor<Anonymize<Idrd3fp3ciqt4f>>;
    /**
        
         */
    QuestionSealed: PlainDescriptor<Anonymize<I15300qnq5mpkt>>;
    /**
        
         */
    QuestionSettled: PlainDescriptor<Anonymize<I7n5sdbabu8l7g>>;
    /**
        
         */
    QuestionVoided: PlainDescriptor<Anonymize<I689heiuu575e6>>;
    /**
        
         */
    AttestorBonded: PlainDescriptor<Anonymize<I6v9f8qobgk41i>>;
    /**
        
         */
    AttestationSubmitted: PlainDescriptor<Anonymize<Ie4auh3nmut3h7>>;
    /**
        
         */
    ServicePauseSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
        
         */
    ServicePauseCleared: PlainDescriptor<undefined>;
    /**
        
         */
    QuestionArchived: PlainDescriptor<Anonymize<Ielk7f0jb1jt1u>>;
  };
  ServiceLedger: {
    /**
     * `split(pid, a)`: minted `a` of both branch-USDC to the caller.
     */
    Split: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `merge(pid, a)`: burned both branch-USDC, paid `a` USDC out.
     */
    Merged: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `split_scalar(pid, b, a)`.
     */
    ScalarSplit: PlainDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * `merge_scalar(pid, b, a)`.
     */
    ScalarMerged: PlainDescriptor<Anonymize<I23de7n843u7sn>>;
    /**
     * `split_gate(pid, b, g, a)`.
     */
    GateSplit: PlainDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * `merge_gate(pid, b, g, a)`.
     */
    GateMerged: PlainDescriptor<Anonymize<I5fe6dsj65bbns>>;
    /**
     * `transfer(position, to, a)`.
     */
    PositionTransferred: PlainDescriptor<Anonymize<I333ps8sjf4lhr>>;
    /**
     * `split_baseline(epoch, a)`.
     */
    BaselineSplit: PlainDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * `merge_baseline(epoch, a)`.
     */
    BaselineMerged: PlainDescriptor<Anonymize<Idasi83b2hi6kd>>;
    /**
     * `resolve(pid, w)` — winning branch (02 §6).
     */
    VaultResolved: PlainDescriptor<Anonymize<Iah5vhnso7uqce>>;
    /**
     * `void(pid)` (02 §6, D-1/X-11f).
     */
    VaultVoided: PlainDescriptor<Anonymize<Ibihfmtr4nutgv>>;
    /**
     * `settle_scalar(pid, s)` — carries the winning branch (02 §6, B-low).
     */
    ScalarSettlementSet: PlainDescriptor<Anonymize<I2lct6m7k5r2et>>;
    /**
     * `settle_gate(pid, g, outcome)` — winning-branch breach outcome (02 §6, B-2).
     */
    GateSettled: PlainDescriptor<Anonymize<I9cf6so4vur6mg>>;
    /**
     * `settle_baseline(epoch, s)`.
     */
    BaselineSettled: PlainDescriptor<Anonymize<Id6e8lk3pfjocj>>;
    /**
     * `redeem(pid, a)` — the par leg, **fee-exempt** (03 §5.3a(1), G-3), so
     * it deliberately carries no `fee` field (02 §6 rule 3).
     */
    Redeemed: PlainDescriptor<Anonymize<I6bpho1qciu1vq>>;
    /**
     * `redeem_scalar(pid, kind, a)` — `payout` is the post-rounding
     * **gross**, `fee` the 03 §5.3a deduction, so `net = payout − fee`
     * (02 §6 rule 1, contract v17).
     */
    ScalarRedeemed: PlainDescriptor<Anonymize<Isntabb3i2t9f>>;
    /**
     * `redeem_scalar_pair(pid, a)` (02 §6, B-5) — `amount` is exactly `a`
     * gross; `fee` is `fee_pair(a)` per 03 §5.3a(2a), **not** `fee(a)`.
     */
    ScalarPairRedeemed: PlainDescriptor<Anonymize<I40af445fa06rh>>;
    /**
     * `redeem_gate(pid, g, a)` — `amount` gross, `fee` the deduction.
     */
    GateRedeemed: PlainDescriptor<Anonymize<Iapmmsuq8j9rcn>>;
    /**
     * `redeem_void(pid, kind, a)` (02 §6, D-1) — `amount` burned, `payout`
     * paid. **Fee-exempt** (03 §5.3a(1)), so no `fee` field (rule 3).
     */
    VoidRedeemed: PlainDescriptor<Anonymize<I80dirtbv2ognl>>;
    /**
     * `redeem_baseline*` — `payout` gross, `fee` the deduction.
     */
    BaselineRedeemed: PlainDescriptor<Anonymize<I6qrovovkeah6g>>;
    /**
     * `sweep_redemption_fees()` moved the accrued balance to the treasury
     * `MAIN` account and zeroed the counter (02 §6, contract v17; 03 §5.4).
     * A sweep on an empty counter is a successful no-op and still emits,
     * with `amount = 0`.
     */
    RedemptionFeesSwept: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
    /**
     * `sweep_dust(pid)` completed — residual escrow swept to INSURANCE (02 §6).
     */
    VaultReaped: PlainDescriptor<Anonymize<I5v7n6l8j8vd1f>>;
    /**
     * `sweep_dust_baseline(epoch)` completed.
     */
    BaselineVaultReaped: PlainDescriptor<Anonymize<I2kpgolvhr6ftt>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    SplitPauseSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    SplitPauseCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeSet: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeCleared: PlainDescriptor<undefined>;
    /**
     * Operational event outside the frozen 02 ingest schema.
     */
    FreezeExtended: PlainDescriptor<Anonymize<I20e9ph536u7ti>>;
    /**
     * The reconciliation crank crossed from healthy to undercollateralized.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    LedgerDriftDetected: PlainDescriptor<Anonymize<Id2312c48f17dd>>;
    /**
     * The reconciliation crank crossed from undercollateralized to healthy.
     * Operational edge event outside the frozen 02 ingest schema.
     */
    LedgerDriftCleared: PlainDescriptor<Anonymize<Id2312c48f17dd>>;
  };
  TradingRewards: {
    /**
     * A bond was held and a participant record opened.
     */
    Enrolled: PlainDescriptor<Anonymize<I93vothlkfb80t>>;
    /**
     * The hold grew. The earning cap did not.
     */
    BondToppedUp: PlainDescriptor<Anonymize<I34ssr4fhp2kik>>;
    /**
     * The whole bond was released. `record_retained` is true when an
     * unclaimed accrual kept the record alive at a zero bond, which is
     * the one case where a withdrawal does not close the account.
     */
    BondWithdrawn: PlainDescriptor<Anonymize<Icctupj3ftl0ch>>;
    /**
     * Accrued USDC was converted once, at the live rate, and paid in VIT.
     * `record_closed` is true when the claim was the last thing holding a
     * zero-bond record open, so the roster slot was freed with it.
     */
    RewardsClaimed: PlainDescriptor<Anonymize<I86dulb0e6aqlq>>;
    /**
     * A settled market was folded into the epoch total and its entry
     * deleted. `spent` and `received` are what the fold contributed, which
     * is not the entry's own pair when 08 §2.6 rule 4's annulled arm
     * substitutes the mirror leg for the sale credits.
     */
    MarketScoreFolded: PlainDescriptor<Anonymize<Iffhjj19aangi6>>;
    /**
     * A score entry was deleted without folding anything: the proposal was
     * VOIDed, or the absolute timeout elapsed on a market that never
     * settled. `timed_out` separates the two, because one is a resolved
     * constitutional emergency and the other is a liveness escape.
     */
    MarketScoreDropped: PlainDescriptor<Anonymize<Ib6pl1520ec2jq>>;
    /**
     * One participant's epoch closed. `accrued` is the reward, clamped to
     * the authorized budget's unpromised remainder; `forfeited` is the
     * debit, which budget pressure never reduces. `snapshot_bond` is the
     * cap the next epoch carries.
     */
    EpochSettled: PlainDescriptor<Anonymize<I75eb7jq67cg5l>>;
  };
};
type IError = {
  System: {
    /**
     * The name of specification does not match between the current runtime
     * and the new runtime.
     */
    InvalidSpecName: PlainDescriptor<undefined>;
    /**
     * The specification version is not allowed to decrease between the current runtime
     * and the new runtime.
     */
    SpecVersionNeedsToIncrease: PlainDescriptor<undefined>;
    /**
     * Failed to extract the runtime version from the new runtime.
     *
     * Either calling `Core_version` or decoding `RuntimeVersion` failed.
     */
    FailedToExtractRuntimeVersion: PlainDescriptor<undefined>;
    /**
     * Suicide called when the account has non-default composite data.
     */
    NonDefaultComposite: PlainDescriptor<undefined>;
    /**
     * There is a non-zero reference count preventing the account from being purged.
     */
    NonZeroRefCount: PlainDescriptor<undefined>;
    /**
     * The origin filter prevent the call to be dispatched.
     */
    CallFiltered: PlainDescriptor<undefined>;
    /**
     * A multi-block migration is ongoing and prevents the current code from being replaced.
     */
    MultiBlockMigrationsOngoing: PlainDescriptor<undefined>;
    /**
     * No upgrade authorized.
     */
    NothingAuthorized: PlainDescriptor<undefined>;
    /**
     * The submitted code is not authorized.
     */
    Unauthorized: PlainDescriptor<undefined>;
  };
  ParachainSystem: {
    /**
     * Attempt to upgrade validation function while existing upgrade pending.
     */
    OverlappingUpgrades: PlainDescriptor<undefined>;
    /**
     * Polkadot currently prohibits this parachain from upgrading its validation function.
     */
    ProhibitedByPolkadot: PlainDescriptor<undefined>;
    /**
     * The supplied validation function has compiled into a blob larger than Polkadot is
     * willing to run.
     */
    TooBig: PlainDescriptor<undefined>;
    /**
     * The inherent which supplies the validation data did not run this block.
     */
    ValidationDataNotAvailable: PlainDescriptor<undefined>;
    /**
     * The inherent which supplies the host configuration did not run this block.
     */
    HostConfigurationNotAvailable: PlainDescriptor<undefined>;
    /**
     * No validation function upgrade is currently scheduled.
     */
    NotScheduled: PlainDescriptor<undefined>;
  };
  Balances: {
    /**
     * Vesting balance too high to send value.
     */
    VestingBalance: PlainDescriptor<undefined>;
    /**
     * Account liquidity restrictions prevent withdrawal.
     */
    LiquidityRestrictions: PlainDescriptor<undefined>;
    /**
     * Balance too low to send value.
     */
    InsufficientBalance: PlainDescriptor<undefined>;
    /**
     * Value too low to create account due to existential deposit.
     */
    ExistentialDeposit: PlainDescriptor<undefined>;
    /**
     * Transfer/payment would kill account.
     */
    Expendability: PlainDescriptor<undefined>;
    /**
     * A vesting schedule already exists for this account.
     */
    ExistingVestingSchedule: PlainDescriptor<undefined>;
    /**
     * Beneficiary account must pre-exist.
     */
    DeadAccount: PlainDescriptor<undefined>;
    /**
     * Number of named reserves exceed `MaxReserves`.
     */
    TooManyReserves: PlainDescriptor<undefined>;
    /**
     * Number of holds exceed `VariantCountOf<T::RuntimeHoldReason>`.
     */
    TooManyHolds: PlainDescriptor<undefined>;
    /**
     * Number of freezes exceed `MaxFreezes`.
     */
    TooManyFreezes: PlainDescriptor<undefined>;
    /**
     * The issuance cannot be modified since it is already deactivated.
     */
    IssuanceDeactivated: PlainDescriptor<undefined>;
    /**
     * The delta cannot be zero.
     */
    DeltaZero: PlainDescriptor<undefined>;
  };
  ForeignAssets: {
    /**
     * Account balance must be greater than or equal to the transfer amount.
     */
    BalanceLow: PlainDescriptor<undefined>;
    /**
     * The account to alter does not exist.
     */
    NoAccount: PlainDescriptor<undefined>;
    /**
     * The signing account has no permission to do the operation.
     */
    NoPermission: PlainDescriptor<undefined>;
    /**
     * The given asset ID is unknown.
     */
    Unknown: PlainDescriptor<undefined>;
    /**
     * The origin account is frozen.
     */
    Frozen: PlainDescriptor<undefined>;
    /**
     * The asset ID is already taken.
     */
    InUse: PlainDescriptor<undefined>;
    /**
     * Invalid witness data given.
     */
    BadWitness: PlainDescriptor<undefined>;
    /**
     * Minimum balance should be non-zero.
     */
    MinBalanceZero: PlainDescriptor<undefined>;
    /**
     * Unable to increment the consumer reference counters on the account. Either no provider
     * reference exists to allow a non-zero balance of a non-self-sufficient asset, or one
     * fewer then the maximum number of consumers has been reached.
     */
    UnavailableConsumer: PlainDescriptor<undefined>;
    /**
     * Invalid metadata given.
     */
    BadMetadata: PlainDescriptor<undefined>;
    /**
     * No approval exists that would allow the transfer.
     */
    Unapproved: PlainDescriptor<undefined>;
    /**
     * The source account would not survive the transfer and it needs to stay alive.
     */
    WouldDie: PlainDescriptor<undefined>;
    /**
     * The asset-account already exists.
     */
    AlreadyExists: PlainDescriptor<undefined>;
    /**
     * The asset-account doesn't have an associated deposit.
     */
    NoDeposit: PlainDescriptor<undefined>;
    /**
     * The operation would result in funds being burned.
     */
    WouldBurn: PlainDescriptor<undefined>;
    /**
     * The asset is a live asset and is actively being used. Usually emit for operations such
     * as `start_destroy` which require the asset to be in a destroying state.
     */
    LiveAsset: PlainDescriptor<undefined>;
    /**
     * The asset is not live, and likely being destroyed.
     */
    AssetNotLive: PlainDescriptor<undefined>;
    /**
     * The asset status is not the expected status.
     */
    IncorrectStatus: PlainDescriptor<undefined>;
    /**
     * The asset should be frozen before the given operation.
     */
    NotFrozen: PlainDescriptor<undefined>;
    /**
     * Callback action resulted in error
     */
    CallbackFailed: PlainDescriptor<undefined>;
    /**
     * The asset ID must be equal to the [`NextAssetId`].
     */
    BadAssetId: PlainDescriptor<undefined>;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain freezes.
     */
    ContainsFreezes: PlainDescriptor<undefined>;
    /**
     * The asset cannot be destroyed because some accounts for this asset contain holds.
     */
    ContainsHolds: PlainDescriptor<undefined>;
    /**
     * Tried setting too many reserves.
     */
    TooManyReserves: PlainDescriptor<undefined>;
  };
  Vesting: {
    /**
     * The account given is not vesting.
     */
    NotVesting: PlainDescriptor<undefined>;
    /**
     * The account already has `MaxVestingSchedules` count of schedules and thus
     * cannot add another one. Consider merging existing schedules in order to add another.
     */
    AtMaxVestingSchedules: PlainDescriptor<undefined>;
    /**
     * Amount being transferred is too low to create a vesting schedule.
     */
    AmountLow: PlainDescriptor<undefined>;
    /**
     * An index was out of bounds of the vesting schedules.
     */
    ScheduleIndexOutOfBounds: PlainDescriptor<undefined>;
    /**
     * Failed to create a new schedule because some parameter was invalid.
     */
    InvalidScheduleParams: PlainDescriptor<undefined>;
  };
  Referenda: {
    /**
     * Referendum is not ongoing.
     */
    NotOngoing: PlainDescriptor<undefined>;
    /**
     * Referendum's decision deposit is already paid.
     */
    HasDeposit: PlainDescriptor<undefined>;
    /**
     * The track identifier given was invalid.
     */
    BadTrack: PlainDescriptor<undefined>;
    /**
     * There are already a full complement of referenda in progress for this track.
     */
    Full: PlainDescriptor<undefined>;
    /**
     * The queue of the track is empty.
     */
    QueueEmpty: PlainDescriptor<undefined>;
    /**
     * The referendum index provided is invalid in this context.
     */
    BadReferendum: PlainDescriptor<undefined>;
    /**
     * There was nothing to do in the advancement.
     */
    NothingToDo: PlainDescriptor<undefined>;
    /**
     * No track exists for the proposal origin.
     */
    NoTrack: PlainDescriptor<undefined>;
    /**
     * Any deposit cannot be refunded until after the decision is over.
     */
    Unfinished: PlainDescriptor<undefined>;
    /**
     * The deposit refunder is not the depositor.
     */
    NoPermission: PlainDescriptor<undefined>;
    /**
     * The deposit cannot be refunded since none was made.
     */
    NoDeposit: PlainDescriptor<undefined>;
    /**
     * The referendum status is invalid for this operation.
     */
    BadStatus: PlainDescriptor<undefined>;
    /**
     * The preimage does not exist.
     */
    PreimageNotExist: PlainDescriptor<undefined>;
    /**
     * The preimage is stored with a different length than the one provided.
     */
    PreimageStoredWithDifferentLength: PlainDescriptor<undefined>;
  };
  ConvictionVoting: {
    /**
     * Poll is not ongoing.
     */
    NotOngoing: PlainDescriptor<undefined>;
    /**
     * The given account did not vote on the poll.
     */
    NotVoter: PlainDescriptor<undefined>;
    /**
     * The actor has no permission to conduct the action.
     */
    NoPermission: PlainDescriptor<undefined>;
    /**
     * The actor has no permission to conduct the action right now but will do in the future.
     */
    NoPermissionYet: PlainDescriptor<undefined>;
    /**
     * The account is already delegating.
     */
    AlreadyDelegating: PlainDescriptor<undefined>;
    /**
     * The account currently has votes attached to it and the operation cannot succeed until
     * these are removed through `remove_vote`.
     */
    AlreadyVoting: PlainDescriptor<undefined>;
    /**
     * Too high a balance was provided that the account cannot afford.
     */
    InsufficientFunds: PlainDescriptor<undefined>;
    /**
     * The account is not currently delegating.
     */
    NotDelegating: PlainDescriptor<undefined>;
    /**
     * Delegation to oneself makes no sense.
     */
    Nonsense: PlainDescriptor<undefined>;
    /**
     * Maximum number of votes reached.
     */
    MaxVotesReached: PlainDescriptor<undefined>;
    /**
     * The class must be supplied since it is not easily determinable from the state.
     */
    ClassNeeded: PlainDescriptor<undefined>;
    /**
     * The class ID supplied is invalid.
     */
    BadClass: PlainDescriptor<undefined>;
  };
  Preimage: {
    /**
     * Preimage is too large to store on-chain.
     */
    TooBig: PlainDescriptor<undefined>;
    /**
     * Preimage has already been noted on-chain.
     */
    AlreadyNoted: PlainDescriptor<undefined>;
    /**
     * The user is not authorized to perform this action.
     */
    NotAuthorized: PlainDescriptor<undefined>;
    /**
     * The preimage cannot be removed since it has not yet been noted.
     */
    NotNoted: PlainDescriptor<undefined>;
    /**
     * A preimage may not be removed when there are outstanding requests.
     */
    Requested: PlainDescriptor<undefined>;
    /**
     * The preimage request cannot be removed since no outstanding requests exist.
     */
    NotRequested: PlainDescriptor<undefined>;
    /**
     * More than `MAX_HASH_UPGRADE_BULK_COUNT` hashes were requested to be upgraded at once.
     */
    TooMany: PlainDescriptor<undefined>;
    /**
     * Too few hashes were requested to be upgraded (i.e. zero).
     */
    TooFew: PlainDescriptor<undefined>;
  };
  Scheduler: {
    /**
     * Failed to schedule a call
     */
    FailedToSchedule: PlainDescriptor<undefined>;
    /**
     * Cannot find the scheduled call.
     */
    NotFound: PlainDescriptor<undefined>;
    /**
     * Given target block number is in the past.
     */
    TargetBlockNumberInPast: PlainDescriptor<undefined>;
    /**
     * Reschedule failed because it does not change scheduled time.
     */
    RescheduleNoChange: PlainDescriptor<undefined>;
    /**
     * Attempt to use a non-named function on a named task.
     */
    Named: PlainDescriptor<undefined>;
  };
  Utility: {
    /**
     * Too many calls batched.
     */
    TooManyCalls: PlainDescriptor<undefined>;
  };
  Proxy: {
    /**
     * There are too many proxies registered or too many announcements pending.
     */
    TooMany: PlainDescriptor<undefined>;
    /**
     * Proxy registration not found.
     */
    NotFound: PlainDescriptor<undefined>;
    /**
     * Sender is not a proxy of the account to be proxied.
     */
    NotProxy: PlainDescriptor<undefined>;
    /**
     * A call which is incompatible with the proxy type's filter was attempted.
     */
    Unproxyable: PlainDescriptor<undefined>;
    /**
     * Account is already a proxy.
     */
    Duplicate: PlainDescriptor<undefined>;
    /**
     * Call may not be made by proxy because it may escalate its privileges.
     */
    NoPermission: PlainDescriptor<undefined>;
    /**
     * Announcement, if made at all, was made too recently.
     */
    Unannounced: PlainDescriptor<undefined>;
    /**
     * Cannot add self as proxy.
     */
    NoSelfProxy: PlainDescriptor<undefined>;
  };
  Multisig: {
    /**
     * Threshold must be 2 or greater.
     */
    MinimumThreshold: PlainDescriptor<undefined>;
    /**
     * Call is already approved by this signatory.
     */
    AlreadyApproved: PlainDescriptor<undefined>;
    /**
     * Call doesn't need any (more) approvals.
     */
    NoApprovalsNeeded: PlainDescriptor<undefined>;
    /**
     * There are too few signatories in the list.
     */
    TooFewSignatories: PlainDescriptor<undefined>;
    /**
     * There are too many signatories in the list.
     */
    TooManySignatories: PlainDescriptor<undefined>;
    /**
     * The signatories were provided out of order; they should be ordered.
     */
    SignatoriesOutOfOrder: PlainDescriptor<undefined>;
    /**
     * The sender was contained in the other signatories; it shouldn't be.
     */
    SenderInSignatories: PlainDescriptor<undefined>;
    /**
     * Multisig operation not found in storage.
     */
    NotFound: PlainDescriptor<undefined>;
    /**
     * Only the account that originally created the multisig is able to cancel it or update
     * its deposits.
     */
    NotOwner: PlainDescriptor<undefined>;
    /**
     * No timepoint was given, yet the multisig operation is already underway.
     */
    NoTimepoint: PlainDescriptor<undefined>;
    /**
     * A different timepoint was given to the multisig operation that is underway.
     */
    WrongTimepoint: PlainDescriptor<undefined>;
    /**
     * A timepoint was given, yet no multisig operation is underway.
     */
    UnexpectedTimepoint: PlainDescriptor<undefined>;
    /**
     * The maximum weight information provided was too low.
     */
    MaxWeightTooLow: PlainDescriptor<undefined>;
    /**
     * The data to be stored is already stored.
     */
    AlreadyStored: PlainDescriptor<undefined>;
  };
  Migrations: {
    /**
     * The operation cannot complete since some MBMs are ongoing.
     */
    Ongoing: PlainDescriptor<undefined>;
  };
  Sudo: {
    /**
     * Sender must be the Sudo account.
     */
    RequireSudo: PlainDescriptor<undefined>;
  };
  XcmpQueue: {
    /**
     * Setting the queue config failed since one of its values was invalid.
     */
    BadQueueConfig: PlainDescriptor<undefined>;
    /**
     * The execution is already suspended.
     */
    AlreadySuspended: PlainDescriptor<undefined>;
    /**
     * The execution is already resumed.
     */
    AlreadyResumed: PlainDescriptor<undefined>;
    /**
     * There are too many active outbound channels.
     */
    TooManyActiveOutboundChannels: PlainDescriptor<undefined>;
    /**
     * The message is too big.
     */
    TooBig: PlainDescriptor<undefined>;
  };
  MessageQueue: {
    /**
     * Page is not reapable because it has items remaining to be processed and is not old
     * enough.
     */
    NotReapable: PlainDescriptor<undefined>;
    /**
     * Page to be reaped does not exist.
     */
    NoPage: PlainDescriptor<undefined>;
    /**
     * The referenced message could not be found.
     */
    NoMessage: PlainDescriptor<undefined>;
    /**
     * The message was already processed and cannot be processed again.
     */
    AlreadyProcessed: PlainDescriptor<undefined>;
    /**
     * The message is queued for future execution.
     */
    Queued: PlainDescriptor<undefined>;
    /**
     * There is temporarily not enough weight to continue servicing messages.
     */
    InsufficientWeight: PlainDescriptor<undefined>;
    /**
     * This message is temporarily unprocessable.
     *
     * Such errors are expected, but not guaranteed, to resolve themselves eventually through
     * retrying.
     */
    TemporarilyUnprocessable: PlainDescriptor<undefined>;
    /**
     * The queue is paused and no message can be executed from it.
     *
     * This can change at any time and may resolve in the future by re-trying.
     */
    QueuePaused: PlainDescriptor<undefined>;
    /**
     * Another call is in progress and needs to finish before this call can happen.
     */
    RecursiveDisallowed: PlainDescriptor<undefined>;
  };
  PolkadotXcm: {
    /**
     * The desired destination was unreachable, generally because there is a no way of routing
     * to it.
     */
    Unreachable: PlainDescriptor<undefined>;
    /**
     * There was some other issue (i.e. not to do with routing) in sending the message.
     * Perhaps a lack of space for buffering the message.
     */
    SendFailure: PlainDescriptor<undefined>;
    /**
     * The message execution fails the filter.
     */
    Filtered: PlainDescriptor<undefined>;
    /**
     * The message's weight could not be determined.
     */
    UnweighableMessage: PlainDescriptor<undefined>;
    /**
     * The destination `Location` provided cannot be inverted.
     */
    DestinationNotInvertible: PlainDescriptor<undefined>;
    /**
     * The assets to be sent are empty.
     */
    Empty: PlainDescriptor<undefined>;
    /**
     * Could not re-anchor the assets to declare the fees for the destination chain.
     */
    CannotReanchor: PlainDescriptor<undefined>;
    /**
     * Too many assets have been attempted for transfer.
     */
    TooManyAssets: PlainDescriptor<undefined>;
    /**
     * Origin is invalid for sending.
     */
    InvalidOrigin: PlainDescriptor<undefined>;
    /**
     * The version of the `Versioned` value used is not able to be interpreted.
     */
    BadVersion: PlainDescriptor<undefined>;
    /**
     * The given location could not be used (e.g. because it cannot be expressed in the
     * desired version of XCM).
     */
    BadLocation: PlainDescriptor<undefined>;
    /**
     * The referenced subscription could not be found.
     */
    NoSubscription: PlainDescriptor<undefined>;
    /**
     * The location is invalid since it already has a subscription from us.
     */
    AlreadySubscribed: PlainDescriptor<undefined>;
    /**
     * Could not check-out the assets for teleportation to the destination chain.
     */
    CannotCheckOutTeleport: PlainDescriptor<undefined>;
    /**
     * The owner does not own (all) of the asset that they wish to do the operation on.
     */
    LowBalance: PlainDescriptor<undefined>;
    /**
     * The asset owner has too many locks on the asset.
     */
    TooManyLocks: PlainDescriptor<undefined>;
    /**
     * The given account is not an identifiable sovereign account for any location.
     */
    AccountNotSovereign: PlainDescriptor<undefined>;
    /**
     * The operation required fees to be paid which the initiator could not meet.
     */
    FeesNotMet: PlainDescriptor<undefined>;
    /**
     * A remote lock with the corresponding data could not be found.
     */
    LockNotFound: PlainDescriptor<undefined>;
    /**
     * The unlock operation cannot succeed because there are still consumers of the lock.
     */
    InUse: PlainDescriptor<undefined>;
    /**
     * Invalid asset, reserve chain could not be determined for it.
     */
    InvalidAssetUnknownReserve: PlainDescriptor<undefined>;
    /**
     * Invalid asset, do not support remote asset reserves with different fees reserves.
     */
    InvalidAssetUnsupportedReserve: PlainDescriptor<undefined>;
    /**
     * Too many assets with different reserve locations have been attempted for transfer.
     */
    TooManyReserves: PlainDescriptor<undefined>;
    /**
     * Local XCM execution incomplete.
     */
    LocalExecutionIncomplete: PlainDescriptor<undefined>;
    /**
     * Too many locations authorized to alias origin.
     */
    TooManyAuthorizedAliases: PlainDescriptor<undefined>;
    /**
     * Expiry block number is in the past.
     */
    ExpiresInPast: PlainDescriptor<undefined>;
    /**
     * The alias to remove authorization for was not found.
     */
    AliasNotFound: PlainDescriptor<undefined>;
    /**
     * Local XCM execution incomplete with the actual XCM error and the index of the
     * instruction that caused the error.
     */
    LocalExecutionIncompleteWithError: PlainDescriptor<Anonymize<I5r8t4iaend96p>>;
  };
  CollatorSelection: {
    /**
     * The pallet has too many candidates.
     */
    TooManyCandidates: PlainDescriptor<undefined>;
    /**
     * Leaving would result in too few candidates.
     */
    TooFewEligibleCollators: PlainDescriptor<undefined>;
    /**
     * Account is already a candidate.
     */
    AlreadyCandidate: PlainDescriptor<undefined>;
    /**
     * Account is not a candidate.
     */
    NotCandidate: PlainDescriptor<undefined>;
    /**
     * There are too many Invulnerables.
     */
    TooManyInvulnerables: PlainDescriptor<undefined>;
    /**
     * Account is already an Invulnerable.
     */
    AlreadyInvulnerable: PlainDescriptor<undefined>;
    /**
     * Account is not an Invulnerable.
     */
    NotInvulnerable: PlainDescriptor<undefined>;
    /**
     * Account has no associated validator ID.
     */
    NoAssociatedValidatorId: PlainDescriptor<undefined>;
    /**
     * Validator ID is not yet registered.
     */
    ValidatorNotRegistered: PlainDescriptor<undefined>;
    /**
     * Could not insert in the candidate list.
     */
    InsertToCandidateListFailed: PlainDescriptor<undefined>;
    /**
     * Could not remove from the candidate list.
     */
    RemoveFromCandidateListFailed: PlainDescriptor<undefined>;
    /**
     * New deposit amount would be below the minimum candidacy bond.
     */
    DepositTooLow: PlainDescriptor<undefined>;
    /**
     * Could not update the candidate list.
     */
    UpdateCandidateListFailed: PlainDescriptor<undefined>;
    /**
     * Deposit amount is too low to take the target's slot in the candidate list.
     */
    InsufficientBond: PlainDescriptor<undefined>;
    /**
     * The target account to be replaced in the candidate list is not a candidate.
     */
    TargetIsNotCandidate: PlainDescriptor<undefined>;
    /**
     * The updated deposit amount is equal to the amount already reserved.
     */
    IdenticalDeposit: PlainDescriptor<undefined>;
    /**
     * Cannot lower candidacy bond while occupying a future collator slot in the list.
     */
    InvalidUnreserve: PlainDescriptor<undefined>;
  };
  Session: {
    /**
     * Invalid ownership proof.
     */
    InvalidProof: PlainDescriptor<undefined>;
    /**
     * No associated validator ID for account.
     */
    NoAssociatedValidatorId: PlainDescriptor<undefined>;
    /**
     * Registered duplicate key.
     */
    DuplicatedKey: PlainDescriptor<undefined>;
    /**
     * No keys are associated with this account.
     */
    NoKeys: PlainDescriptor<undefined>;
    /**
     * Key setting account is not live, so it's impossible to associate keys.
     */
    NoAccount: PlainDescriptor<undefined>;
  };
  Constitution: {
    /**
     * No record exists under the given `ParamKey`.
     */
    UnknownParam: PlainDescriptor<undefined>;
    /**
     * No meter exists at the given index.
     */
    UnknownMeter: PlainDescriptor<undefined>;
    /**
     * Value kind does not match the record's typed kind.
     */
    WrongType: PlainDescriptor<undefined>;
    /**
     * Proposed value below the record's hard minimum (I-6).
     */
    BelowMin: PlainDescriptor<undefined>;
    /**
     * Proposed value above the record's hard maximum (I-6).
     */
    AboveMax: PlainDescriptor<undefined>;
    /**
     * Proposed step exceeds the record's max Δ/decision (I-6).
     */
    DeltaTooLarge: PlainDescriptor<undefined>;
    /**
     * The record's per-key cooldown has not elapsed (I-6).
     */
    CooldownActive: PlainDescriptor<undefined>;
    /**
     * Meter arithmetic overflow — rejected, never wrapped (G-1).
     */
    MeterOverflow: PlainDescriptor<undefined>;
    /**
     * Charge would exceed the meter's kernel envelope (I-7/I-17).
     */
    MeterExhausted: PlainDescriptor<undefined>;
    /**
     * Write touches a reserved `PhaseFlags` bit (02 §7.3).
     */
    ReservedPhaseFlag: PlainDescriptor<undefined>;
    /**
     * `set_phase_flag` touches a machinery bit outside the 09 §5.4
     * sudo-armable set (bits 5–7 are sibling-pallet state).
     */
    FlagNotArmable: PlainDescriptor<undefined>;
    /**
     * Release-channel bytes violate the frozen schema-1 layout (02 §12).
     */
    BadReleaseSchema: PlainDescriptor<undefined>;
    /**
     * Params over the 13 §4 bound (genesis validation only).
     */
    TooManyParams: PlainDescriptor<undefined>;
    /**
     * Meters over the core bound (genesis validation only).
     */
    TooManyMeters: PlainDescriptor<undefined>;
    /**
     * Capability table full.
     */
    TooManyCapabilities: PlainDescriptor<undefined>;
    /**
     * `amend_registry` tried to move a kernel-bounded row's bounds
     * (13 rule 7 — genesis-fixed).
     */
    KernelBoundImmutable: PlainDescriptor<undefined>;
    /**
     * `amend_registry` violates the compile-time meta-bounds
     * (13 rule 2/7: `min ≤ value ≤ max`, kind-consistent, cooldown ≤ 8).
     */
    MetaBoundViolation: PlainDescriptor<undefined>;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * 08 §4.2 (SQ-180): arming a proposal class was refused because
     * published spendable NAV is below that class's 08 §4.1 floor — which
     * includes the fail-static case where the 08 §1.2 reserve-health flag
     * has zeroed spendable NAV outright. `PhaseFlags` is left unchanged.
     */
    NavFloorUnmet: PlainDescriptor<undefined>;
    /**
     * 13 §5 item 6's screening obligation refused this change, fail-closed
     * (SQ-303/SQ-501). Either a class-floor key whose proposed value
     * re-derives an 08 §4.1 NAV floor above the frozen literal, or an
     * occupancy key whose proposed value would grow one of items 1–4's
     * envelopes past the frozen figure the runtime compiles against — both
     * screened **by value**, and both answering this way when the
     * derivation cannot be evaluated at all (G-1). See
     * `constitution_core::Error::BudgetDerivationRequired`.
     */
    BudgetDerivationRequired: PlainDescriptor<undefined>;
    /**
     * 09 §5.2: `phase3.tvl_cap` / `phase3.dep_cap` are raised only by
     * phase gates and are not PARAM/META-adjustable during Phases ≤ 3.
     * Lowering — tightening containment — remains legal at every phase
     * (SQ-197). Deliberately not `BadOrigin`: the origin is authorized,
     * the value direction is not.
     */
    PhaseCapRaiseRefused: PlainDescriptor<undefined>;
    /**
     * 07 §6.3 (SQ-495): the amendment would lower the bond-coverage rate
     * `(2^orc.rounds − 1) · orc.bond_bps` below the `Δs_max` of a component
     * already admitted to a live MetricSpec. Raising coverage is always
     * permitted; only the direction that leaves an admitted component
     * settling money under an uncovering ladder is refused. Deliberately
     * not `BadOrigin` — the origin is authorized, the resulting state is
     * not.
     */
    CoverageBreaksAdmission: PlainDescriptor<undefined>;
    /**
     * 13 rule 7 / 08 §10.6 (E1): the amendment would carry the live pair
     * `ledger.redeem_fee ≤ mkt.fee` out of band. Both rows are **PARAM**,
     * so a single PARAM decision can move either side and both directions
     * are refused: raising `ledger.redeem_fee` above the live `mkt.fee`,
     * and lowering `mkt.fee` beneath the live `ledger.redeem_fee`.
     * Deliberately not `TryStateViolation` (nothing stored is violating an
     * invariant — the refusal is what keeps it that way), not `AboveMax`
     * (the row's own `[0, 100]` bps bounds are satisfied; the live coupling
     * is what binds) and not `BadOrigin` (the origin is authorized, the
     * resulting pair is not). Appended last — the preceding discriminants
     * are SCALE-stable.
     */
    RedemptionFeeAboveMarketFee: PlainDescriptor<undefined>;
    /**
     * 13 rule 7 / 08 §2.6 (TR9): the amendment would carry the live pair
     * `99 × rwd.rate ≤ 200 × mkt.fee` out of band. Both rows are **PARAM**,
     * so a single PARAM decision can move either side and both directions
     * are refused: raising `rwd.rate` above the live wash break-even, and
     * lowering `mkt.fee` until the live `rwd.rate` sits above it.
     *
     * The second direction is the one this error exists for. `mkt.fee` may
     * be lowered toward its 5 bps floor by an ordinary vote that never
     * mentions the reward program, and that vote would otherwise retire
     * the program's only anti-farm defense.
     *
     * Deliberately not `TryStateViolation` (nothing stored is violating an
     * invariant — the refusal is what keeps it that way) and not `AboveMax`
     * (the `rwd.rate` record's own bounds are satisfied; the live coupling
     * is what binds). Appended last — the preceding discriminants are
     * SCALE-stable.
     */
    RewardRateAboveWashBreakeven: PlainDescriptor<undefined>;
  };
  ConditionalLedger: {
    /**
     * Origin was not the internal authority the call requires (defensive; the
     * pallet checks origins before the core, so the happy path never sees it).
     */
    BadOrigin: PlainDescriptor<undefined>;
    /**
     * No proposal vault exists for the given id.
     */
    UnknownVault: PlainDescriptor<undefined>;
    /**
     * No Baseline vault exists for the given epoch.
     */
    UnknownBaselineVault: PlainDescriptor<undefined>;
    /**
     * The vault/Baseline vault is not in a state that admits this operation
     * (03 §2.3 transition table; the coarse status-quo default, G-1).
     */
    WrongVaultState: PlainDescriptor<undefined>;
    /**
     * Amount is below `MinSplit`/`MinTransfer` (03 §7 R-2).
     */
    BelowMinimum: PlainDescriptor<undefined>;
    /**
     * Checked conservation arithmetic overflowed (03 §6/§8).
     */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
     * Caller does not hold enough of the required instrument.
     */
    InsufficientPosition: PlainDescriptor<undefined>;
    /**
     * Creating the entry would exceed `MaxPositionsPerAccount` (03 §4).
     */
    TooManyPositions: PlainDescriptor<undefined>;
    /**
     * Settlement score `s` is outside `[0, 1]` (1e9 scale).
     */
    InvalidScore: PlainDescriptor<undefined>;
    /**
     * The gate outcome for this gate is already recorded.
     */
    GateAlreadySettled: PlainDescriptor<undefined>;
    /**
     * The gate outcome for this gate is not yet recorded.
     */
    GateNotSettled: PlainDescriptor<undefined>;
    /**
     * A conservation invariant was violated (surfaces only from the core's
     * internal consistency guards; try-state maps drift to I-4).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * The vault is not yet reap-eligible: not terminal, or `ArchiveDelay` has
     * not elapsed, or an associated seeded market has not completed its
     * 04 §2 Sweep (03 §5.4 / 04 §2).
     */
    ReapNotDue: PlainDescriptor<undefined>;
    /**
     * The position-storage deposit could not be taken from the entry owner
     * (03 §4 / §8).
     */
    DepositFailed: PlainDescriptor<undefined>;
    /**
     * PB-RESERVE currently blocks public split inflows.
     */
    SplitPaused: PlainDescriptor<undefined>;
    /**
     * PB-LEDGER-FREEZE currently blocks public ledger funds movement.
     */
    Frozen: PlainDescriptor<undefined>;
    /**
     * The requested expiry is in the past or beyond the kernel window.
     */
    FreezeOutOfBounds: PlainDescriptor<undefined>;
    /**
     * The one pallet-level LedgerFreeze renewal was already consumed.
     */
    FreezeRenewalExhausted: PlainDescriptor<undefined>;
    /**
     * New escrow is halted because global USDC issuance or the signer's
     * cumulative Phase-3 deposit meter is already above its live cap.
     */
    InflowCapExceeded: PlainDescriptor<undefined>;
    /**
     * Signed users cannot route positions into deposit-exempt protocol
     * custody; only the MarketAuthority wrapper may do so (03 §4/§5.1).
     */
    ProtocolDestination: PlainDescriptor<undefined>;
  };
  Market: {
    /**
        
         */
    UnknownMarket: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateMarket: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateBaselineMarket: PlainDescriptor<undefined>;
    /**
        
         */
    NotTrading: PlainDescriptor<undefined>;
    /**
        
         */
    AmountTooSmall: PlainDescriptor<undefined>;
    /**
        
         */
    AmountTooLarge: PlainDescriptor<undefined>;
    /**
        
         */
    SlippageExceeded: PlainDescriptor<undefined>;
    /**
        
         */
    PriceBoundExceeded: PlainDescriptor<undefined>;
    /**
        
         */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    Ledger: PlainDescriptor<undefined>;
    /**
        
         */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
        
         */
    BadOrigin: PlainDescriptor<undefined>;
    /**
        
         */
    NotReapable: PlainDescriptor<undefined>;
    /**
     * Creating this book would exceed `MaxLiveMarkets = 196` (I-21).
     */
    TooManyMarkets: PlainDescriptor<undefined>;
    /**
     * Creating this book would exceed the archive-derived stored-book cap.
     */
    TooManyStoredMarkets: PlainDescriptor<undefined>;
    /**
     * The book's POL headroom has already been seeded (04 §10, idempotence).
     */
    AlreadySeeded: PlainDescriptor<undefined>;
    /**
     * PB-DEPEG blocks book creation/seeding until its bounded expiry.
     */
    CreationFrozen: PlainDescriptor<undefined>;
    /**
     * PB-LEDGER-FREEZE blocks trading/observation until its bounded expiry.
     */
    Frozen: PlainDescriptor<undefined>;
    /**
     * The requested expiry is in the past or beyond its kernel bound.
     */
    FreezeOutOfBounds: PlainDescriptor<undefined>;
    /**
     * The one pallet-level LedgerFreeze renewal was already consumed.
     */
    FreezeRenewalExhausted: PlainDescriptor<undefined>;
    /**
     * A proposed book/fee address is not the canonical, permanently
     * reserved protocol-custody address for this market id.
     */
    UnreservedProtocolAccount: PlainDescriptor<undefined>;
    /**
     * The explicit event epoch disagrees with an embedded Baseline epoch.
     *
     * This is append-only: the market error discriminants above are part
     * of retained dispatch metadata and must not be renumbered.
     */
    EpochMismatch: PlainDescriptor<undefined>;
    /**
     * The book's 04 §2 Sweep preconditions are unmet: it is still open, its
     * owning vault is not terminal, or a gate outcome it must price is not
     * recorded yet. Status-quo and retryable — never a silent empty sweep.
     */
    NotSweepable: PlainDescriptor<undefined>;
    /**
     * External live/retained capacity is independent from protocol POL.
     */
    TooManyExternalMarkets: PlainDescriptor<undefined>;
    /**
     * A protocol-only operation was presented an external book or vice versa.
     */
    WrongFundingDomain: PlainDescriptor<undefined>;
    /**
     * The supplied external subsidy account is not the immutable funder.
     */
    FunderMismatch: PlainDescriptor<undefined>;
    /**
     * A hosted question already owns its immutable two-book record.
     */
    DuplicateExternalQuestion: PlainDescriptor<undefined>;
    /**
     * A primary/service identifier crossed `SERVICE_ID_BASE`.
     */
    InvalidIdBand: PlainDescriptor<undefined>;
  };
  Welfare: {
    /**
        
         */
    TooManyMetricSpecs: PlainDescriptor<undefined>;
    /**
        
         */
    TooManySnapshots: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyComponents: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyGateFlags: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateSpecVersion: PlainDescriptor<undefined>;
    /**
        
         */
    SpecNotFound: PlainDescriptor<undefined>;
    /**
        
         */
    BadActivationEpoch: PlainDescriptor<undefined>;
    /**
        
         */
    SpecNotActive: PlainDescriptor<undefined>;
    /**
        
         */
    MissingMetricDiscipline: PlainDescriptor<undefined>;
    /**
        
         */
    BadEpsilonFloor: PlainDescriptor<undefined>;
    /**
        
         */
    BadSourceClass: PlainDescriptor<undefined>;
    /**
        
         */
    BadWeightSum: PlainDescriptor<undefined>;
    /**
        
         */
    ValueOutOfRange: PlainDescriptor<undefined>;
    /**
        
         */
    MissingComponent: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateComponent: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateSnapshot: PlainDescriptor<undefined>;
    /**
        
         */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
        
         */
    BadParams: PlainDescriptor<undefined>;
    /**
     * A snapshot/daily-gate crank named an epoch that has not finalized yet
     * (`epoch >= CurrentEpoch`). 05 §4.6 winsorizes over *finalized* epoch
     * values, so a keeper may only record an epoch the clock has passed.
     */
    EpochNotFinalized: PlainDescriptor<undefined>;
    /**
     * Gate-market settlement was asked to resolve a cohort whose e+1…e+2
     * window contains an epoch with no recorded daily observation at all
     * (05 §4.7; SQ-79). The gate input is unavailable, so settlement holds
     * at the status quo and the cohort takes 07 §10's VOID.
     */
    GateWindowUnsampled: PlainDescriptor<undefined>;
    /**
     * The A-pillar milestone component declares no positive `target`, so
     * 05 §4.3's `min(1, points ÷ target)` has no defined value (07 §7).
     */
    MilestoneTargetUnset: PlainDescriptor<undefined>;
    /**
     * An attested component's `delta_s_max_bps` is outside `(0, 10_000]`
     * (05 §4.4).
     */
    BadDeltaSMax: PlainDescriptor<undefined>;
    /**
     * 07 §2(5): fewer than `orc.n_min` reporters or fewer than `wt.quorum`
     * watchtowers are registered, so an attested component's game could not
     * be adjudicated.
     */
    InsufficientOracleSeats: PlainDescriptor<undefined>;
    /**
     * 07 §6.3: the live bond ladder does not cover the component's declared
     * `Δs_max`, so a lie about it would cost less than it can move. Also
     * returned when the ladder is unreadable — the fail-closed direction.
     */
    BondCoverageUnmet: PlainDescriptor<undefined>;
    /**
     * The registry has no closed incident aggregate for this
     * `(epoch, spec_version)`, so `C_attested`'s multiplier is unknown
     * (07 §7, SQ-141). The snapshot is refused rather than resolved to the
     * favourable neutral 1.0; 07 §11(1)'s d20 money deadline guarantees the
     * record exists in time, so this is a retry, not a wedge.
     */
    IncidentAggregateUnavailable: PlainDescriptor<undefined>;
    /**
     * A flagged component offered for a snapshot is not an **attested**
     * component of that spec version (07 §10; §11(1)(i)). Only class-4
     * components are reportable, so only they can carry a flagged epoch.
     */
    BadFlaggedComponent: PlainDescriptor<undefined>;
    /**
     * A snapshot exists with no 07 §10 settlement context beside it. The two
     * are written and retired atomically, so this is a corrupted-state
     * signal rather than a reachable outcome.
     */
    MissingSnapshotContext: PlainDescriptor<undefined>;
    /**
     * A 05 §4.6 percentile was asked of an empty winsorization sample. The
     * `prior_bounds ++ finalized` assembly is always 12 elements, so this
     * is a corrupted-state signal rather than a reachable outcome.
     */
    EmptyNormalizationSample: PlainDescriptor<undefined>;
    /**
     * The 05 §4.6 min–max range is zero-width, so the component's raw
     * series has no map onto [0,1]. Refused rather than resolved to the
     * adopt-favourable 1.0 (G-1).
     */
    DegenerateNormalizationRange: PlainDescriptor<undefined>;
    /**
     * The named day is not in the epoch's measurable day set (05 §4.7): the
     * epoch had fewer whole days than that, or its timing is no longer
     * retained so membership cannot be decided. Appended, not inserted —
     * error indices are part of the decoded surface (02 §13).
     */
    DayOutsideEpoch: PlainDescriptor<undefined>;
    /**
     * The named `spec_version` is activated by the epoch but is not one
     * the epoch may be measured under: for `record_snapshot`, neither the
     * epoch's active spec nor a version any live cohort froze for it
     * (I-16); for `record_daily_gate`, not the epoch's active spec at all
     * — `GateBreachFlags` is keyed by epoch alone and settles money, so
     * it admits exactly one version. Appended, not inserted (02 §13).
     */
    SpecVersionNotAdmissible: PlainDescriptor<undefined>;
  };
  Oracle: {
    /**
     * Caller is already a registered reporter/watchtower (07 §3/§4).
     */
    AlreadyRegistered: PlainDescriptor<undefined>;
    /**
     * Caller is not a registered reporter/watchtower (07 §3/§4).
     */
    NotRegistered: PlainDescriptor<undefined>;
    /**
     * Reporter registry is full (`MAX_REPORTERS`).
     */
    TooManyReporters: PlainDescriptor<undefined>;
    /**
     * Watchtower registry is full (`wt.max = 16`).
     */
    TooManyWatchtowers: PlainDescriptor<undefined>;
    /**
     * The challenge/report window has closed (07 §5).
     */
    WindowClosed: PlainDescriptor<undefined>;
    /**
     * The window is still open / round not yet resolvable (07 §5).
     */
    WindowOpen: PlainDescriptor<undefined>;
    /**
     * Posted bond is below the value-scaled minimum (07 §6).
     */
    BondBelowMinimum: PlainDescriptor<undefined>;
    /**
     * The report names a version other than the frozen cohort version (07 §2(4)).
     */
    SpecVersionMismatch: PlainDescriptor<undefined>;
    /**
     * The `(component, epoch, version)` is already settled — final (I-18).
     */
    AlreadyFinal: PlainDescriptor<undefined>;
    /**
     * This round already carries a challenge (07 §5.2).
     */
    AlreadyChallenged: PlainDescriptor<undefined>;
    /**
     * A quorum decision is still pending for this round (07 §4).
     */
    QuorumPending: PlainDescriptor<undefined>;
    /**
     * No round exists for the given key (07 §5).
     */
    RoundNotFound: PlainDescriptor<undefined>;
    /**
     * Live-round registry is full (`MAX_ROUNDS`).
     */
    RoundLimit: PlainDescriptor<undefined>;
    /**
     * This watchtower already acknowledged this round (07 §4).
     */
    DuplicateAck: PlainDescriptor<undefined>;
    /**
     * A reserve-unhealthy condition blocked the action (07 §8).
     */
    ReserveUnhealthy: PlainDescriptor<undefined>;
    /**
     * The reserve probe interval has not elapsed (07 §8).
     */
    ProbeTooEarly: PlainDescriptor<undefined>;
    /**
     * The reserve probe has not yet passed its funding/readiness gate.
     */
    ProbeUnavailable: PlainDescriptor<undefined>;
    /**
     * The `query_id` does not match the outstanding probe (07 §8).
     */
    UnknownQuery: PlainDescriptor<undefined>;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    Overflow: PlainDescriptor<undefined>;
    /**
     * The frozen spec does not declare this component recomputable (07 §9).
     */
    NotRecomputable: PlainDescriptor<undefined>;
    /**
     * `recompute_proof` payload exceeds `orc.max_proof_bytes` (07 §9).
     */
    ProofTooLarge: PlainDescriptor<undefined>;
    /**
     * The proof does not match the committed evidence hash (07 §9).
     */
    EvidenceMismatch: PlainDescriptor<undefined>;
    /**
     * The committed payload does not decode to a valid value (07 §9).
     */
    BadProof: PlainDescriptor<undefined>;
    /**
     * A reported/adjudicated value is off the 05 §4.4 `[0, 1]` grid.
     */
    ValueOutOfBounds: PlainDescriptor<undefined>;
    /**
     * 07 §5.2 (contract v19): the round's own reporter may not challenge
     * it. §5.5 disposes of a round in favour of "the honest counterparty"
     * and §5.3 calls escalation "opt-in on both sides"; both are undefined
     * when one account holds both roles.
     */
    SelfChallenge: PlainDescriptor<undefined>;
    /**
     * 07 §3 (contract v19): an account ejected on the third adjudicated
     * -false finding may never re-register. Ejection is permanent.
     */
    ReporterEjected: PlainDescriptor<undefined>;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * 07 §3 saturation clause: the retained-record store is full of
     * ejections, so no fresh registration can be proved not to be a
     * dropped ban re-entering. Permissionless entry closes until a CODE
     * change enlarges the store. Appended last — SCALE discriminants are
     * positional.
     */
    ReporterRecordsSaturated: PlainDescriptor<undefined>;
  };
  IncidentRegistry: {
    /**
     * The per-epoch filing cap (`MaxFilingsPerEpoch`) is reached.
     */
    EpochFull: PlainDescriptor<undefined>;
    /**
     * More than `MAX_LIVE_EPOCHS` epochs have live filings.
     */
    TooManyLiveEpochs: PlainDescriptor<undefined>;
    /**
     * More than `MAX_AGGREGATES` closed-epoch aggregates are retained.
     */
    TooManyAggregates: PlainDescriptor<undefined>;
    /**
     * The filing/challenge window has closed.
     */
    WindowClosed: PlainDescriptor<undefined>;
    /**
     * The window/challenge round is still open (premature close/resolve).
     */
    WindowOpen: PlainDescriptor<undefined>;
    /**
     * The filing is already challenged (registry games do not escalate).
     */
    AlreadyChallenged: PlainDescriptor<undefined>;
    /**
     * The filing is already terminal.
     */
    AlreadyFinal: PlainDescriptor<undefined>;
    /**
     * The report names a spec version other than the frozen one (I-16).
     */
    SpecVersionMismatch: PlainDescriptor<undefined>;
    /**
     * The required bond is zero / below minimum.
     */
    BondBelowMinimum: PlainDescriptor<undefined>;
    /**
     * No filing with that `(epoch, filing_id)`.
     */
    FilingNotFound: PlainDescriptor<undefined>;
    /**
     * This watchtower already acknowledged this filing.
     */
    DuplicateAck: PlainDescriptor<undefined>;
    /**
     * The close batch exceeds `REG_CLOSE_BATCH`.
     */
    BatchTooLarge: PlainDescriptor<undefined>;
    /**
     * The filing class is invalid for this instance's kind.
     */
    InvalidClass: PlainDescriptor<undefined>;
    /**
     * Checked arithmetic overflowed (G-1).
     */
    Overflow: PlainDescriptor<undefined>;
    /**
     * The acker is not a registered bonded watchtower (07 §4).
     */
    NotRegistered: PlainDescriptor<undefined>;
    /**
     * The core state validator rejected the aggregate (try-state only).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * A lossy `AccountId` bridge would alias distinct accounts (02 §8).
     */
    BadAccount: PlainDescriptor<undefined>;
    /**
     * The filing already has `WT_QUORUM` acknowledgments (07 §4).
     */
    AlreadyQuorum: PlainDescriptor<undefined>;
    /**
     * The epoch is not yet reap-eligible: not closed, or `ArchiveDelay` has
     * not elapsed since close (07 §7).
     */
    ReapNotDue: PlainDescriptor<undefined>;
    /**
     * `close_epoch` on an epoch with no live filings — nothing to close
     * (an empty epoch is welfare's "no record ⇒ 1" default, and a reaped
     * epoch must never re-close, 07 §7).
     */
    NothingToClose: PlainDescriptor<undefined>;
    /**
     * The Milestone instance's frozen-MetricSpec completion `target` is zero
     * or absent, so `min(1, points ÷ target)` is undefined: `file` and
     * `close_epoch` both refuse rather than record a fabricated `0.0`
     * A-pillar component (07 §7 *Milestone normalization*). Appended last —
     * the preceding variant indices are metadata-stable (02 §13).
     */
    MilestoneTargetUnset: PlainDescriptor<undefined>;
    /**
     * The epoch's cohort exposure cannot be determined, so the
     * value-scaled filing bond cannot be priced (07 §7; G-1). Appended last
     * to preserve every preceding metadata discriminant.
     */
    ExposureUnavailable: PlainDescriptor<undefined>;
    /**
     * The terminal verdict named an evidence hash other than the one the
     * challenge committed, so it was authored against a different filing than
     * the one it would resolve. The bond stays custodied (07 §7; G-1).
     * Appended last to preserve every preceding metadata discriminant.
     */
    EvidenceMismatch: PlainDescriptor<undefined>;
  };
  MilestoneRegistry: {
    /**
     * The per-epoch filing cap (`MaxFilingsPerEpoch`) is reached.
     */
    EpochFull: PlainDescriptor<undefined>;
    /**
     * More than `MAX_LIVE_EPOCHS` epochs have live filings.
     */
    TooManyLiveEpochs: PlainDescriptor<undefined>;
    /**
     * More than `MAX_AGGREGATES` closed-epoch aggregates are retained.
     */
    TooManyAggregates: PlainDescriptor<undefined>;
    /**
     * The filing/challenge window has closed.
     */
    WindowClosed: PlainDescriptor<undefined>;
    /**
     * The window/challenge round is still open (premature close/resolve).
     */
    WindowOpen: PlainDescriptor<undefined>;
    /**
     * The filing is already challenged (registry games do not escalate).
     */
    AlreadyChallenged: PlainDescriptor<undefined>;
    /**
     * The filing is already terminal.
     */
    AlreadyFinal: PlainDescriptor<undefined>;
    /**
     * The report names a spec version other than the frozen one (I-16).
     */
    SpecVersionMismatch: PlainDescriptor<undefined>;
    /**
     * The required bond is zero / below minimum.
     */
    BondBelowMinimum: PlainDescriptor<undefined>;
    /**
     * No filing with that `(epoch, filing_id)`.
     */
    FilingNotFound: PlainDescriptor<undefined>;
    /**
     * This watchtower already acknowledged this filing.
     */
    DuplicateAck: PlainDescriptor<undefined>;
    /**
     * The close batch exceeds `REG_CLOSE_BATCH`.
     */
    BatchTooLarge: PlainDescriptor<undefined>;
    /**
     * The filing class is invalid for this instance's kind.
     */
    InvalidClass: PlainDescriptor<undefined>;
    /**
     * Checked arithmetic overflowed (G-1).
     */
    Overflow: PlainDescriptor<undefined>;
    /**
     * The acker is not a registered bonded watchtower (07 §4).
     */
    NotRegistered: PlainDescriptor<undefined>;
    /**
     * The core state validator rejected the aggregate (try-state only).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * A lossy `AccountId` bridge would alias distinct accounts (02 §8).
     */
    BadAccount: PlainDescriptor<undefined>;
    /**
     * The filing already has `WT_QUORUM` acknowledgments (07 §4).
     */
    AlreadyQuorum: PlainDescriptor<undefined>;
    /**
     * The epoch is not yet reap-eligible: not closed, or `ArchiveDelay` has
     * not elapsed since close (07 §7).
     */
    ReapNotDue: PlainDescriptor<undefined>;
    /**
     * `close_epoch` on an epoch with no live filings — nothing to close
     * (an empty epoch is welfare's "no record ⇒ 1" default, and a reaped
     * epoch must never re-close, 07 §7).
     */
    NothingToClose: PlainDescriptor<undefined>;
    /**
     * The Milestone instance's frozen-MetricSpec completion `target` is zero
     * or absent, so `min(1, points ÷ target)` is undefined: `file` and
     * `close_epoch` both refuse rather than record a fabricated `0.0`
     * A-pillar component (07 §7 *Milestone normalization*). Appended last —
     * the preceding variant indices are metadata-stable (02 §13).
     */
    MilestoneTargetUnset: PlainDescriptor<undefined>;
    /**
     * The epoch's cohort exposure cannot be determined, so the
     * value-scaled filing bond cannot be priced (07 §7; G-1). Appended last
     * to preserve every preceding metadata discriminant.
     */
    ExposureUnavailable: PlainDescriptor<undefined>;
    /**
     * The terminal verdict named an evidence hash other than the one the
     * challenge committed, so it was authored against a different filing than
     * the one it would resolve. The bond stays custodied (07 §7; G-1).
     * Appended last to preserve every preceding metadata discriminant.
     */
    EvidenceMismatch: PlainDescriptor<undefined>;
  };
  FutarchyTreasury: {
    /**
     * No such budget line exists in the treasury.
     */
    UnknownBudgetLine: PlainDescriptor<undefined>;
    /**
     * The source (main or a line) lacks the funds for the debit.
     */
    InsufficientFunds: PlainDescriptor<undefined>;
    /**
     * The reserve-health flag is set: spendable NAV is 0, no new commitments.
     */
    ReserveImpaired: PlainDescriptor<undefined>;
    /**
     * Outflow exceeds `trs.cap_proposal` × spendable NAV.
     */
    ProposalCapExceeded: PlainDescriptor<undefined>;
    /**
     * Grant exceeds `trs.stream_threshold`: it MUST be a stream, not a spend.
     */
    StreamRequired: PlainDescriptor<undefined>;
    /**
     * A rolling outflow (30d/180d) or issuance meter would be exceeded (I-7).
     */
    MeterExhausted: PlainDescriptor<undefined>;
    /**
     * No stream with the given id.
     */
    StreamNotFound: PlainDescriptor<undefined>;
    /**
     * Nothing vested-but-unclaimed on the stream.
     */
    StreamNotClaimable: PlainDescriptor<undefined>;
    /**
     * Caller is not the stream's recipient.
     */
    NotRecipient: PlainDescriptor<undefined>;
    /**
     * The stream is already cancelled.
     */
    AlreadyCancelled: PlainDescriptor<undefined>;
    /**
     * Stream duration must be non-zero.
     */
    BadDuration: PlainDescriptor<undefined>;
    /**
     * No coretime renewal quote is open for this period (window closed).
     */
    RenewalWindowClosed: PlainDescriptor<undefined>;
    /**
     * This coretime period is already funded (renewal idempotency).
     */
    PeriodAlreadyFunded: PlainDescriptor<undefined>;
    /**
     * The `Streams` bound (13 §4) would be exceeded.
     */
    TooManyStreams: PlainDescriptor<undefined>;
    /**
     * The budget-line bound (13 §4) would be exceeded.
     */
    TooManyBudgetLines: PlainDescriptor<undefined>;
    /**
     * A pending-outflow / POL / coretime obligation bound (13 §4) would be exceeded.
     */
    TooManyObligations: PlainDescriptor<undefined>;
    /**
     * `issue_vit` targets a line other than `REWARDS`/`ops.*` (08 §2.3).
     */
    IssuanceLineNotAllowed: PlainDescriptor<undefined>;
    /**
     * Minting would exceed `iss.inflation_cap` × supply-at-window-start.
     */
    IssuanceCapExceeded: PlainDescriptor<undefined>;
    /**
     * `recover_foreign` was asked to move a protocol asset (USDC/VIT).
     */
    UnknownForeignAsset: PlainDescriptor<undefined>;
    /**
     * Published spendable NAV is below the class arming floor (08 §4.1).
     */
    NavFloorUnmet: PlainDescriptor<undefined>;
    /**
     * A coretime renewal quote of zero was rejected (09 §4).
     */
    ZeroQuote: PlainDescriptor<undefined>;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    Overflow: PlainDescriptor<undefined>;
    /**
     * Signed caller is not the stored Coretime quote authority.
     */
    NotQuoteAuthority: PlainDescriptor<undefined>;
    /**
     * The ops multisig tried to fund a non-`ops.*` line.
     */
    BootstrapOpsLineOnly: PlainDescriptor<undefined>;
    /**
     * The one-way governed-funding handover closed bootstrap ops funding.
     */
    BootstrapOpsFundingClosed: PlainDescriptor<undefined>;
    /**
     * A signed reserve-probe top-up was zero, over the exact live runway,
     * or the governed runway inputs were unavailable.
     */
    BootstrapOpsFundingLimit: PlainDescriptor<undefined>;
    /**
     * No Coretime renewal destination is configured.
     */
    RenewalAccountUnset: PlainDescriptor<undefined>;
    /**
     * The quote freshness window elapsed.
     */
    QuoteExpired: PlainDescriptor<undefined>;
    /**
     * A permissionless prune was attempted before expiry.
     */
    QuoteNotExpired: PlainDescriptor<undefined>;
    /**
     * The applicable DOT→USDC rate is absent, malformed, or zero.
     */
    RateUnset: PlainDescriptor<undefined>;
    /**
     * `ops.ct_fee_dot` is absent, malformed, or zero.
     */
    FeeBudgetUnset: PlainDescriptor<undefined>;
    /**
     * `ops.ct_quote_ttl` is absent, malformed, or zero.
     */
    QuoteTtlUnset: PlainDescriptor<undefined>;
    /**
     * Stored quote timestamp is ahead of the current block.
     */
    QuoteTimestampInFuture: PlainDescriptor<undefined>;
    /**
     * Community distribution has not reached Phase-4 arming.
     */
    CommunityDistributionNotArmed: PlainDescriptor<undefined>;
    /**
     * The requested tranche is below the 13 minimum.
     */
    CommunityDistributionAmountTooSmall: PlainDescriptor<undefined>;
    /**
     * The requested tranche exceeds the undistributed community pot.
     */
    CommunityDistributionExhausted: PlainDescriptor<undefined>;
    /**
     * The bounded community-schedule count is full.
     */
    TooManyCommunitySchedules: PlainDescriptor<undefined>;
    /**
     * The 24-month duration is zero or cannot yield a positive per-block
     * unlock rate for a minimum-sized tranche.
     */
    CommunityVestingDurationInvalid: PlainDescriptor<undefined>;
    /**
     * A beneficiary may not be the source pot itself.
     */
    CommunityBeneficiaryIsPot: PlainDescriptor<undefined>;
    /**
     * The call's real-asset leg is not wired in this runtime, so it would
     * have reported a value movement that never happened (08 §1.4's A9
     * fungibles follow-up). Status-quo default: refuse (G-1).
     *
     * Appended, never inserted: `Error` variants carry SCALE indices that
     * off-chain consumers decode, so a new variant goes at the end (02 §13
     * append-only rule) rather than shifting every variant after it.
     */
    OutflowCustodyUnwired: PlainDescriptor<undefined>;
    /**
     * `fund_trading_rewards`'s amount exceeds the undistributed
     * `incentiv` pot (08 §2.6).
     */
    IncentiveAllocationExhausted: PlainDescriptor<undefined>;
    /**
     * The bounded lifetime trading-reward authorization count (08 §2.6,
     * *Bounds*) is full.
     */
    TooManyTradingRewardAuthorizations: PlainDescriptor<undefined>;
  };
  Guardian: {
    /**
     * The council has not been elected yet (no `Members`).
     */
    NotInitialized: PlainDescriptor<undefined>;
    /**
     * Caller is not a current council member.
     */
    NotMember: PlainDescriptor<undefined>;
    /**
     * A proposed member set contains a duplicate seat.
     */
    DuplicateMember: PlainDescriptor<undefined>;
    /**
     * The member already approved this action.
     */
    DuplicateApproval: PlainDescriptor<undefined>;
    /**
     * No pending action with that id.
     */
    ActionNotFound: PlainDescriptor<undefined>;
    /**
     * The action's 3-day window elapsed.
     */
    ActionExpired: PlainDescriptor<undefined>;
    /**
     * The action already dispatched.
     */
    AlreadyDispatched: PlainDescriptor<undefined>;
    /**
     * Live pending-action set is full (`MAX_PENDING_ACTIONS`).
     */
    TooManyPending: PlainDescriptor<undefined>;
    /**
     * Approval ledger is full (`MAX_APPROVALS`).
     */
    TooManyApprovals: PlainDescriptor<undefined>;
    /**
     * Open-review set is full (`MAX_REVIEWS`).
     */
    TooManyReviews: PlainDescriptor<undefined>;
    /**
     * Active-playbook set is full (`MAX_ACTIVE_PLAYBOOKS`).
     */
    TooManyActivePlaybooks: PlainDescriptor<undefined>;
    /**
     * Rerun ledger is full (`MAX_RERUN_USED`).
     */
    TooManyReruns: PlainDescriptor<undefined>;
    /**
     * Fewer than five approvals (should not surface — internal).
     */
    ThresholdNotMet: PlainDescriptor<undefined>;
    /**
     * The power's allowance is exhausted this epoch/window (06 §5.2).
     */
    AllowanceExhausted: PlainDescriptor<undefined>;
    /**
     * A hold/playbook duration exceeds its kernel maximum (06 §5.2/§6.3).
     */
    DurationTooLong: PlainDescriptor<undefined>;
    /**
     * The playbook's verified on-chain trigger is not live (06 §6.2).
     */
    TriggerInactive: PlainDescriptor<undefined>;
    /**
     * The playbook/trigger pairing is not admissible (06 §6.2).
     */
    BadPlaybookTrigger: PlainDescriptor<undefined>;
    /**
     * OracleVoid requires a cohort target; every other playbook forbids one.
     */
    BadPlaybookTarget: PlainDescriptor<undefined>;
    /**
     * The proposal was already rerun, or is inside a rerun (06 §5.3).
     */
    AlreadyRerun: PlainDescriptor<undefined>;
    /**
     * The proposal is not in a rerunnable state (06 §5.3).
     */
    NotRerunnable: PlainDescriptor<undefined>;
    /**
     * No review record for that action.
     */
    ReviewNotFound: PlainDescriptor<undefined>;
    /**
     * The review was already ratified.
     */
    AlreadyRatified: PlainDescriptor<undefined>;
    /**
     * Renewal is inadmissible (not `PB-LEDGER-FREEZE`, or already renewed —
     * 06 §6.3: one renewal only).
     */
    RenewalNotAllowed: PlainDescriptor<undefined>;
    /**
     * The playbook is already active.
     */
    PlaybookAlreadyActive: PlainDescriptor<undefined>;
    /**
     * Arithmetic overflow — rejected, never wrapped (G-1).
     */
    Overflow: PlainDescriptor<undefined>;
    /**
     * Core state validator rejected the aggregate (try-state only).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * The failed-action recall record is absent or already reaped.
     */
    FailedActionNotFound: PlainDescriptor<undefined>;
    /**
     * `uphold_veto` targets a non-delay action.
     */
    NotDelayAction: PlainDescriptor<undefined>;
    /**
     * The bounded post-term bond-release queue is full.
     */
    TooManyBondReleases: PlainDescriptor<undefined>;
    /**
     * Held funds, the obligation ledger and fronting slices disagree.
     */
    BondAccounting: PlainDescriptor<undefined>;
    /**
     * The values-governed availability toggle is disabled.
     */
    PlaybookNotRegistered: PlainDescriptor<undefined>;
  };
  Attestor: {
    /**
        
         */
    NotMember: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateMember: PlainDescriptor<undefined>;
    /**
        
         */
    TooFewMembers: PlainDescriptor<undefined>;
    /**
        
         */
    AttestationNotFound: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateAttestation: PlainDescriptor<undefined>;
    /**
        
         */
    ChallengeWindowClosed: PlainDescriptor<undefined>;
    /**
        
         */
    ChallengeAlreadyOpen: PlainDescriptor<undefined>;
    /**
        
         */
    ChallengeBondTooSmall: PlainDescriptor<undefined>;
    /**
     * Retained metadata only — no dispatch can return it (SQ-342).
     * Superseded by [`Error::ChallengeOpen`]; kept because the SCALE error
     * surface is append-only.
     */
    ChallengeStillOpen: PlainDescriptor<undefined>;
    /**
     * Retained metadata only — no dispatch can return it (SQ-342). Its
     * producer, a caller-less `require_quorum` helper, is deleted;
     * production branches on the boolean quorum instead.
     */
    QuorumMissing: PlainDescriptor<undefined>;
    /**
     * The referenced attestation exists but has no open challenge.
     */
    NoOpenChallenge: PlainDescriptor<undefined>;
    /**
     * try-state only: a member at or past the ejection threshold is still
     * active. No dispatch produces this (06 §7; SQ-262).
     */
    EjectedMemberActive: PlainDescriptor<undefined>;
    /**
        
         */
    Overflow: PlainDescriptor<undefined>;
    /**
        
         */
    NotInitialized: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyAttestors: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyAttestations: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyLiabilities: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyRevocations: PlainDescriptor<undefined>;
    /**
        
         */
    LiabilityExists: PlainDescriptor<undefined>;
    /**
        
         */
    AttestorNotFound: PlainDescriptor<undefined>;
    /**
        
         */
    LiabilityNotFound: PlainDescriptor<undefined>;
    /**
        
         */
    ProposalNotTerminal: PlainDescriptor<undefined>;
    /**
        
         */
    ChallengeOpen: PlainDescriptor<undefined>;
    /**
        
         */
    ReapNotAllowed: PlainDescriptor<undefined>;
    /**
        
         */
    BondAccounting: PlainDescriptor<undefined>;
    /**
     * `attest` named a `pid` that `pallet-epoch` does not carry. 06 §7
     * scopes an attestation to "a CODE/META artifact" of a real proposal;
     * a record naming no proposal can never be reaped, because
     * terminality is read from the proposal.
     */
    UnknownProposal: PlainDescriptor<undefined>;
    /**
     * The signer already holds their [`MAX_ATTESTATIONS_PER_ATTESTOR`]
     * share of the frozen 256-record ledger.
     */
    AttestorQuotaExceeded: PlainDescriptor<undefined>;
  };
  Epoch: {
    /**
        
         */
    BadPhase: PlainDescriptor<undefined>;
    /**
        
         */
    IntakeFull: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyLiveProposals: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyResources: PlainDescriptor<undefined>;
    /**
        
         */
    UnknownProposal: PlainDescriptor<undefined>;
    /**
        
         */
    BadState: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateProposal: PlainDescriptor<undefined>;
    /**
        
         */
    LockConflict: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyCohorts: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyCohortProposals: PlainDescriptor<undefined>;
    /**
        
         */
    BadEpochLength: PlainDescriptor<undefined>;
    /**
        
         */
    BadParams: PlainDescriptor<undefined>;
    /**
        
         */
    BadDecisionInput: PlainDescriptor<undefined>;
    /**
        
         */
    BatchTooLarge: PlainDescriptor<undefined>;
    /**
        
         */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    Ledger: PlainDescriptor<undefined>;
    /**
        
         */
    ExecutionGuard: PlainDescriptor<undefined>;
    /**
        
         */
    Welfare: PlainDescriptor<undefined>;
    /**
        
         */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
        
         */
    BadProposalShape: PlainDescriptor<undefined>;
    /**
     * Intake is paused by a guardian action or PB-HALT-INTAKE.
     */
    IntakePaused: PlainDescriptor<undefined>;
    /**
     * The requested pause is in the past or exceeds the kernel window.
     */
    IntakePauseOutOfBounds: PlainDescriptor<undefined>;
  };
  ExecutionGuard: {
    /**
        
         */
    QueueFull: PlainDescriptor<undefined>;
    /**
        
         */
    NotFound: PlainDescriptor<undefined>;
    /**
        
         */
    Cancelled: PlainDescriptor<undefined>;
    /**
        
         */
    NotMature: PlainDescriptor<undefined>;
    /**
        
         */
    GraceExpired: PlainDescriptor<undefined>;
    /**
        
         */
    BadPreimage: PlainDescriptor<undefined>;
    /**
        
         */
    StaleQueue: PlainDescriptor<undefined>;
    /**
        
         */
    NotRatified: PlainDescriptor<undefined>;
    /**
        
         */
    AttestationMissing: PlainDescriptor<undefined>;
    /**
        
         */
    CapabilityDenied: PlainDescriptor<undefined>;
    /**
        
         */
    MetersBlocked: PlainDescriptor<undefined>;
    /**
        
         */
    ResourceLockMissing: PlainDescriptor<undefined>;
    /**
        
         */
    GuardianHold: PlainDescriptor<undefined>;
    /**
        
         */
    GateSuspended: PlainDescriptor<undefined>;
    /**
        
         */
    FreezeActive: PlainDescriptor<undefined>;
    /**
        
         */
    PayloadTooLarge: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyCalls: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyDomains: PlainDescriptor<undefined>;
    /**
        
         */
    TooManyLocks: PlainDescriptor<undefined>;
    /**
        
         */
    BadDomainDeclaration: PlainDescriptor<undefined>;
    /**
        
         */
    SafetyFilter: PlainDescriptor<undefined>;
    /**
        
         */
    DispatchFailed: PlainDescriptor<undefined>;
    /**
        
         */
    BadUpgradePayload: PlainDescriptor<undefined>;
    /**
        
         */
    PendingUpgradeExists: PlainDescriptor<undefined>;
    /**
        
         */
    NoPendingUpgrade: PlainDescriptor<undefined>;
    /**
        
         */
    DescriptorLeadTime: PlainDescriptor<undefined>;
    /**
        
         */
    UpgradeHashMismatch: PlainDescriptor<undefined>;
    /**
        
         */
    UpgradeVersionMismatch: PlainDescriptor<undefined>;
    /**
        
         */
    RecoveryImageMissing: PlainDescriptor<undefined>;
    /**
        
         */
    RecoveryImageInvalid: PlainDescriptor<undefined>;
    /**
        
         */
    ShadowMode: PlainDescriptor<undefined>;
    /**
        
         */
    PhaseFourBridgeUsed: PlainDescriptor<undefined>;
    /**
        
         */
    JustificationMissing: PlainDescriptor<undefined>;
    /**
        
         */
    RetryWindowOpen: PlainDescriptor<undefined>;
    /**
        
         */
    Overflow: PlainDescriptor<undefined>;
  };
  ClientRegistry: {
    /**
        
         */
    ClientBondUnset: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateLocation: PlainDescriptor<undefined>;
    /**
        
         */
    ClientsFull: PlainDescriptor<undefined>;
    /**
        
         */
    ClientIdExhausted: PlainDescriptor<undefined>;
    /**
        
         */
    NotRegistered: PlainDescriptor<undefined>;
    /**
        
         */
    ClientRemoved: PlainDescriptor<undefined>;
    /**
        
         */
    QuestionCounterOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    NoLiveQuestions: PlainDescriptor<undefined>;
    /**
        
         */
    BondInsufficient: PlainDescriptor<undefined>;
    /**
        
         */
    BondAccounting: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatAmountZero: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatInsufficient: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatWouldDrain: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatBelowMinimum: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFundingWouldDust: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    DeliveryFloatAccounting: PlainDescriptor<undefined>;
  };
  QuestionService: {
    /**
        
         */
    NotRegistered: PlainDescriptor<undefined>;
    /**
        
         */
    ClientRemoved: PlainDescriptor<undefined>;
    /**
        
         */
    ServicePaused: PlainDescriptor<undefined>;
    /**
        
         */
    ServiceRateUnset: PlainDescriptor<undefined>;
    /**
        
         */
    CertificationUnavailable: PlainDescriptor<undefined>;
    /**
        
         */
    StakeBelowFloor: PlainDescriptor<undefined>;
    /**
     * 16 §8.4: admitting this question would push `Σ b_ext` above
     * `Σ pol.b(live)`, making the external side the dominant market.
     */
    ArmingBoundExceeded: PlainDescriptor<undefined>;
    /**
        
         */
    SubsidyBelowMinimum: PlainDescriptor<undefined>;
    /**
        
         */
    EpsilonOutOfRange: PlainDescriptor<undefined>;
    /**
        
         */
    WindowTooLong: PlainDescriptor<undefined>;
    /**
        
         */
    WindowTooShort: PlainDescriptor<undefined>;
    /**
        
         */
    WindowCollidesWithDecision: PlainDescriptor<undefined>;
    /**
        
         */
    SlotsExhausted: PlainDescriptor<undefined>;
    /**
        
         */
    TvlCapWouldBind: PlainDescriptor<undefined>;
    /**
        
         */
    AttestorSetTooSmall: PlainDescriptor<undefined>;
    /**
        
         */
    AttestorBondInsufficient: PlainDescriptor<undefined>;
    /**
        
         */
    ClientIsProtocolAccount: PlainDescriptor<undefined>;
    /**
        
         */
    EscrowInsufficient: PlainDescriptor<undefined>;
    /**
        
         */
    NotSealed: PlainDescriptor<undefined>;
    /**
        
         */
    AlreadySealed: PlainDescriptor<undefined>;
    /**
        
         */
    AlreadyTerminal: PlainDescriptor<undefined>;
    /**
        
         */
    QuorumNotReached: PlainDescriptor<undefined>;
    /**
        
         */
    MedianOutOfRange: PlainDescriptor<undefined>;
    /**
        
         */
    DeadlineNotReached: PlainDescriptor<undefined>;
    /**
        
         */
    UnknownQuestion: PlainDescriptor<undefined>;
    /**
        
         */
    DeadlinePassed: PlainDescriptor<undefined>;
    /**
        
         */
    CreationFrozen: PlainDescriptor<undefined>;
    /**
        
         */
    DuplicateAttestor: PlainDescriptor<undefined>;
    /**
        
         */
    UnknownAttestor: PlainDescriptor<undefined>;
    /**
        
         */
    AlreadyBonded: PlainDescriptor<undefined>;
    /**
        
         */
    InvalidSubId: PlainDescriptor<undefined>;
    /**
        
         */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
        
         */
    ArchiveNotReady: PlainDescriptor<undefined>;
    /**
        
         */
    TryStateViolation: PlainDescriptor<undefined>;
  };
  ServiceLedger: {
    /**
     * Origin was not the internal authority the call requires (defensive; the
     * pallet checks origins before the core, so the happy path never sees it).
     */
    BadOrigin: PlainDescriptor<undefined>;
    /**
     * No proposal vault exists for the given id.
     */
    UnknownVault: PlainDescriptor<undefined>;
    /**
     * No Baseline vault exists for the given epoch.
     */
    UnknownBaselineVault: PlainDescriptor<undefined>;
    /**
     * The vault/Baseline vault is not in a state that admits this operation
     * (03 §2.3 transition table; the coarse status-quo default, G-1).
     */
    WrongVaultState: PlainDescriptor<undefined>;
    /**
     * Amount is below `MinSplit`/`MinTransfer` (03 §7 R-2).
     */
    BelowMinimum: PlainDescriptor<undefined>;
    /**
     * Checked conservation arithmetic overflowed (03 §6/§8).
     */
    ArithmeticOverflow: PlainDescriptor<undefined>;
    /**
     * Caller does not hold enough of the required instrument.
     */
    InsufficientPosition: PlainDescriptor<undefined>;
    /**
     * Creating the entry would exceed `MaxPositionsPerAccount` (03 §4).
     */
    TooManyPositions: PlainDescriptor<undefined>;
    /**
     * Settlement score `s` is outside `[0, 1]` (1e9 scale).
     */
    InvalidScore: PlainDescriptor<undefined>;
    /**
     * The gate outcome for this gate is already recorded.
     */
    GateAlreadySettled: PlainDescriptor<undefined>;
    /**
     * The gate outcome for this gate is not yet recorded.
     */
    GateNotSettled: PlainDescriptor<undefined>;
    /**
     * A conservation invariant was violated (surfaces only from the core's
     * internal consistency guards; try-state maps drift to I-4).
     */
    TryStateViolation: PlainDescriptor<undefined>;
    /**
     * The vault is not yet reap-eligible: not terminal, or `ArchiveDelay` has
     * not elapsed, or an associated seeded market has not completed its
     * 04 §2 Sweep (03 §5.4 / 04 §2).
     */
    ReapNotDue: PlainDescriptor<undefined>;
    /**
     * The position-storage deposit could not be taken from the entry owner
     * (03 §4 / §8).
     */
    DepositFailed: PlainDescriptor<undefined>;
    /**
     * PB-RESERVE currently blocks public split inflows.
     */
    SplitPaused: PlainDescriptor<undefined>;
    /**
     * PB-LEDGER-FREEZE currently blocks public ledger funds movement.
     */
    Frozen: PlainDescriptor<undefined>;
    /**
     * The requested expiry is in the past or beyond the kernel window.
     */
    FreezeOutOfBounds: PlainDescriptor<undefined>;
    /**
     * The one pallet-level LedgerFreeze renewal was already consumed.
     */
    FreezeRenewalExhausted: PlainDescriptor<undefined>;
    /**
     * New escrow is halted because global USDC issuance or the signer's
     * cumulative Phase-3 deposit meter is already above its live cap.
     */
    InflowCapExceeded: PlainDescriptor<undefined>;
    /**
     * Signed users cannot route positions into deposit-exempt protocol
     * custody; only the MarketAuthority wrapper may do so (03 §4/§5.1).
     */
    ProtocolDestination: PlainDescriptor<undefined>;
  };
  TradingRewards: {
    /**
     * The account already holds a participant record.
     */
    AlreadyEnrolled: PlainDescriptor<undefined>;
    /**
     * No participant record exists for the account.
     */
    NotEnrolled: PlainDescriptor<undefined>;
    /**
     * `rwd.rate` is absent, malformed, or zero. Fails before any hold.
     */
    RateUnset: PlainDescriptor<undefined>;
    /**
     * `ledger.pos_dep` is unreadable, so no minimum can be enforced.
     */
    MinimumBondUnset: PlainDescriptor<undefined>;
    /**
     * The offered bond is below the live minimum.
     */
    BondBelowMinimum: PlainDescriptor<undefined>;
    /**
     * The roster is at its 13 §4 bound.
     */
    TooManyParticipants: PlainDescriptor<undefined>;
    /**
     * A zero-amount bond mutation.
     */
    AmountZero: PlainDescriptor<undefined>;
    /**
     * The bond, the roster count or the accrual total would overflow.
     */
    AccountingOverflow: PlainDescriptor<undefined>;
    /**
     * Some epoch the account participated in has not settled.
     */
    EpochUnsettled: PlainDescriptor<undefined>;
    /**
     * Nothing is accrued, or the conversion floors to zero VIT.
     */
    NothingToClaim: PlainDescriptor<undefined>;
    /**
     * `fee.vit_usdc_rate` is absent, malformed, or zero.
     */
    VitRateUnset: PlainDescriptor<undefined>;
    /**
     * USDC custody refused the move, or moved the wrong amount.
     */
    BondCustody: PlainDescriptor<undefined>;
    /**
     * VIT custody refused the payout, or paid the wrong amount.
     */
    RewardCustody: PlainDescriptor<undefined>;
    /**
     * Transferring the bond would leave the funder below the asset minimum.
     */
    BondFundingWouldDust: PlainDescriptor<undefined>;
    /**
     * No score entry exists for that account and market.
     */
    NoScoreEntry: PlainDescriptor<undefined>;
    /**
     * The book has not reached a terminal state and the absolute timeout
     * has not elapsed, so there is nothing to fold and nothing to escape.
     */
    MarketNotSettled: PlainDescriptor<undefined>;
    /**
     * The account's epoch in flight has not closed. This is also the
     * refusal a second `settle_epoch` for a settled epoch meets, because
     * settling re-snapshots the record onto the current epoch.
     */
    EpochNotClosed: PlainDescriptor<undefined>;
    /**
     * The account still holds an unfolded score entry for the epoch, so
     * settling would apply the arithmetic to part of its own score.
     */
    UnfoldedScore: PlainDescriptor<undefined>;
    /**
     * The accrual would promise more than the authorized budget.
     * Unreachable by construction while `settle_epoch`'s reward clamp
     * (`budget.saturating_sub(promised)`) is in place; kept as a
     * tripwire against a future change that breaks it. If it ever fires,
     * the failure mode is a stuck settlement, not a skipped reward: the
     * whole dispatch aborts, so the epoch stays unclosed and the bond
     * stays locked until a later call succeeds.
     */
    BudgetExceeded: PlainDescriptor<undefined>;
    /**
     * A caller who is **not** the participant tried to settle an epoch
     * into a headroom that would clamp the reward below the full
     * entitlement (08 §2.6).
     *
     * The participant may always settle themselves at any headroom, and a
     * third party may still crank every epoch the clamp does not touch.
     * The refusal is status-quo (G-1): the epoch stays open, the bond
     * stays held, and nothing is written — so re-funding the budget
     * reopens the payout, which is exactly what finalising the epoch would
     * have made impossible.
     */
    ThirdPartyWouldClampReward: PlainDescriptor<undefined>;
  };
};
type IConstants = {
  System: {
    /**
     * Block & extrinsics weights: base values and limits.
     */
    BlockWeights: PlainDescriptor<Anonymize<In7a38730s6qs>>;
    /**
     * The maximum length of a block (in bytes).
     */
    BlockLength: PlainDescriptor<Anonymize<Ibtil0ss5munbk>>;
    /**
     * Maximum number of block number to block hash mappings to keep (oldest pruned first).
     */
    BlockHashCount: PlainDescriptor<number>;
    /**
     * The weight of runtime database operations the runtime can invoke.
     */
    DbWeight: PlainDescriptor<Anonymize<I9s0ave7t0vnrk>>;
    /**
     * Get the chain's in-code version.
     */
    Version: PlainDescriptor<Anonymize<I4fo08joqmcqnm>>;
    /**
     * The designated SS58 prefix of this chain.
     *
     * This replaces the "ss58Format" property declared in the chain spec. Reason is
     * that the runtime should know about the prefix in order to make use of it as
     * an identifier of the chain.
     */
    SS58Prefix: PlainDescriptor<number>;
  };
  Timestamp: {
    /**
     * The minimum period between blocks.
     *
     * Be aware that this is different to the *expected* period that the block production
     * apparatus provides. Your chosen consensus system will generally work with this to
     * determine a sensible block time. For example, in the Aura pallet it will be double this
     * period on default settings.
     */
    MinimumPeriod: PlainDescriptor<bigint>;
  };
  ParachainSystem: {
    /**
     * Returns the parachain ID we are running with.
     */
    SelfParaId: PlainDescriptor<number>;
  };
  Balances: {
    /**
     * The minimum amount required to keep an account open. MUST BE GREATER THAN ZERO!
     *
     * If you *really* need it to be zero, you can enable the feature `insecure_zero_ed` for
     * this pallet. However, you do so at your own risk: this will open up a major DoS vector.
     * In case you have multiple sources of provider references, you may also get unexpected
     * behaviour if you set this to zero.
     *
     * Bottom line: Do yourself a favour and make it at least one!
     */
    ExistentialDeposit: PlainDescriptor<bigint>;
    /**
     * The maximum number of locks that should exist on an account.
     * Not strictly enforced, but used for weight estimation.
     *
     * Use of locks is deprecated in favour of freezes. See `https://github.com/paritytech/substrate/pull/12951/`
     */
    MaxLocks: PlainDescriptor<number>;
    /**
     * The maximum number of named reserves that can exist on an account.
     *
     * Use of reserves is deprecated in favour of holds. See `https://github.com/paritytech/substrate/pull/12951/`
     */
    MaxReserves: PlainDescriptor<number>;
    /**
     * The maximum number of individual freeze locks that can exist on an account at any time.
     */
    MaxFreezes: PlainDescriptor<number>;
  };
  ForeignAssets: {
    /**
     * Max number of items to destroy per `destroy_accounts` and `destroy_approvals` call.
     *
     * Must be configured to result in a weight that makes each call fit in a block.
     */
    RemoveItemsLimit: PlainDescriptor<number>;
    /**
     * The basic amount of funds that must be reserved for an asset.
     */
    AssetDeposit: PlainDescriptor<bigint>;
    /**
     * The amount of funds that must be reserved for a non-provider asset account to be
     * maintained.
     */
    AssetAccountDeposit: PlainDescriptor<bigint>;
    /**
     * The basic amount of funds that must be reserved when adding metadata to your asset.
     */
    MetadataDepositBase: PlainDescriptor<bigint>;
    /**
     * The additional funds that must be reserved for the number of bytes you store in your
     * metadata.
     */
    MetadataDepositPerByte: PlainDescriptor<bigint>;
    /**
     * The amount of funds that must be reserved when creating a new approval.
     */
    ApprovalDeposit: PlainDescriptor<bigint>;
    /**
     * The maximum length of a name or symbol stored on-chain.
     */
    StringLimit: PlainDescriptor<number>;
  };
  TransactionPayment: {
    /**
     * A fee multiplier for `Operational` extrinsics to compute "virtual tip" to boost their
     * `priority`
     *
     * This value is multiplied by the `final_fee` to obtain a "virtual tip" that is later
     * added to a tip component in regular `priority` calculations.
     * It means that a `Normal` transaction can front-run a similarly-sized `Operational`
     * extrinsic (with no tip), by including a tip value greater than the virtual tip.
     *
     * ```rust,ignore
     * // For `Normal`
     * let priority = priority_calc(tip);
     *
     * // For `Operational`
     * let virtual_tip = (inclusion_fee + tip) * OperationalFeeMultiplier;
     * let priority = priority_calc(tip + virtual_tip);
     * ```
     *
     * Note that since we use `final_fee` the multiplier applies also to the regular `tip`
     * sent with the transaction. So, not only does the transaction get a priority bump based
     * on the `inclusion_fee`, but we also amplify the impact of tips applied to `Operational`
     * transactions.
     */
    OperationalFeeMultiplier: PlainDescriptor<number>;
  };
  Vesting: {
    /**
     * The minimum amount transferred to call `vested_transfer`.
     */
    MinVestedTransfer: PlainDescriptor<bigint>;
    /**
        
         */
    MaxVestingSchedules: PlainDescriptor<number>;
  };
  Referenda: {
    /**
     * The minimum amount to be used as a deposit for a public referendum proposal.
     */
    SubmissionDeposit: PlainDescriptor<bigint>;
    /**
     * Maximum size of the referendum queue for a single track.
     */
    MaxQueued: PlainDescriptor<number>;
    /**
     * The number of blocks after submission that a referendum must begin being decided by.
     * Once this passes, then anyone may cancel the referendum.
     */
    UndecidingTimeout: PlainDescriptor<number>;
    /**
     * Quantization level for the referendum wakeup scheduler. A higher number will result in
     * fewer storage reads/writes needed for smaller voters, but also result in delays to the
     * automatic referendum status changes. Explicit servicing instructions are unaffected.
     */
    AlarmInterval: PlainDescriptor<number>;
    /**
     * A list of tracks.
     *
     * Note: if the tracks are dynamic, the value in the static metadata might be inaccurate.
     */
    Tracks: PlainDescriptor<Anonymize<Ibafpkl9hhno69>>;
  };
  ConvictionVoting: {
    /**
     * The maximum number of concurrent votes an account may have.
     *
     * Also used to compute weight, an overly large value can lead to extrinsics with large
     * weight estimation: see `delegate` for instance.
     */
    MaxVotes: PlainDescriptor<number>;
    /**
     * The minimum period of vote locking.
     *
     * It should be no shorter than enactment period to ensure that in the case of an approval,
     * those successful voters are locked into the consequences that their votes entail.
     */
    VoteLockingPeriod: PlainDescriptor<number>;
  };
  Scheduler: {
    /**
     * The maximum weight that may be scheduled per block for any dispatchables.
     */
    MaximumWeight: PlainDescriptor<Anonymize<I4q39t5hn830vp>>;
    /**
     * The maximum number of scheduled calls in the queue for a single block.
     *
     * NOTE:
     * + Dependent pallets' benchmarks might require a higher limit for the setting. Set a
     * higher limit under `runtime-benchmarks` feature.
     */
    MaxScheduledPerBlock: PlainDescriptor<number>;
  };
  Utility: {
    /**
     * The limit on the number of batched calls.
     */
    batched_calls_limit: PlainDescriptor<number>;
  };
  Proxy: {
    /**
     * The base amount of currency needed to reserve for creating a proxy.
     *
     * This is held for an additional storage item whose value size is
     * `sizeof(Balance)` bytes and whose key size is `sizeof(AccountId)` bytes.
     */
    ProxyDepositBase: PlainDescriptor<bigint>;
    /**
     * The amount of currency needed per proxy added.
     *
     * This is held for adding 32 bytes plus an instance of `ProxyType` more into a
     * pre-existing storage value. Thus, when configuring `ProxyDepositFactor` one should take
     * into account `32 + proxy_type.encode().len()` bytes of data.
     */
    ProxyDepositFactor: PlainDescriptor<bigint>;
    /**
     * The maximum amount of proxies allowed for a single account.
     */
    MaxProxies: PlainDescriptor<number>;
    /**
     * The maximum amount of time-delayed announcements that are allowed to be pending.
     */
    MaxPending: PlainDescriptor<number>;
    /**
     * The base amount of currency needed to reserve for creating an announcement.
     *
     * This is held when a new storage item holding a `Balance` is created (typically 16
     * bytes).
     */
    AnnouncementDepositBase: PlainDescriptor<bigint>;
    /**
     * The amount of currency needed per announcement made.
     *
     * This is held for adding an `AccountId`, `Hash` and `BlockNumber` (typically 68 bytes)
     * into a pre-existing storage value.
     */
    AnnouncementDepositFactor: PlainDescriptor<bigint>;
  };
  Multisig: {
    /**
     * The base amount of currency needed to reserve for creating a multisig execution or to
     * store a dispatch call for later.
     *
     * This is held for an additional storage item whose value size is
     * `4 + sizeof((BlockNumber, Balance, AccountId))` bytes and whose key size is
     * `32 + sizeof(AccountId)` bytes.
     */
    DepositBase: PlainDescriptor<bigint>;
    /**
     * The amount of currency needed per unit threshold when creating a multisig execution.
     *
     * This is held for adding 32 bytes more into a pre-existing storage value.
     */
    DepositFactor: PlainDescriptor<bigint>;
    /**
     * The maximum amount of signatories allowed in the multisig.
     */
    MaxSignatories: PlainDescriptor<number>;
  };
  Migrations: {
    /**
     * The maximal length of an encoded cursor.
     *
     * A good default needs to selected such that no migration will ever have a cursor with MEL
     * above this limit. This is statically checked in `integrity_test`.
     */
    CursorMaxLen: PlainDescriptor<number>;
    /**
     * The maximal length of an encoded identifier.
     *
     * A good default needs to selected such that no migration will ever have an identifier
     * with MEL above this limit. This is statically checked in `integrity_test`.
     */
    IdentifierMaxLen: PlainDescriptor<number>;
  };
  XcmpQueue: {
    /**
     * The maximum number of inbound XCMP channels that can be suspended simultaneously.
     *
     * Any further channel suspensions will fail and messages may get dropped without further
     * notice. Choosing a high value (1000) is okay; the trade-off that is described in
     * [`InboundXcmpSuspended`] still applies at that scale.
     */
    MaxInboundSuspended: PlainDescriptor<number>;
    /**
     * Maximal number of outbound XCMP channels that can have messages queued at the same time.
     *
     * If this is reached, then no further messages can be sent to channels that do not yet
     * have a message queued. This should be set to the expected maximum of outbound channels
     * which is determined by [`Self::ChannelInfo`]. It is important to set this large enough,
     * since otherwise the congestion control protocol will not work as intended and messages
     * may be dropped. This value increases the PoV and should therefore not be picked too
     * high. Governance needs to pay attention to not open more channels than this value.
     */
    MaxActiveOutboundChannels: PlainDescriptor<number>;
    /**
     * The maximal page size for HRMP message pages.
     *
     * A lower limit can be set dynamically, but this is the hard-limit for the PoV worst case
     * benchmarking. The limit for the size of a message is slightly below this, since some
     * overhead is incurred for encoding the format.
     */
    MaxPageSize: PlainDescriptor<number>;
  };
  MessageQueue: {
    /**
     * The size of the page; this implies the maximum message size which can be sent.
     *
     * A good value depends on the expected message sizes, their weights, the weight that is
     * available for processing them and the maximal needed message size. The maximal message
     * size is slightly lower than this as defined by [`MaxMessageLenOf`].
     */
    HeapSize: PlainDescriptor<number>;
    /**
     * The maximum number of stale pages (i.e. of overweight messages) allowed before culling
     * can happen. Once there are more stale pages than this, then historical pages may be
     * dropped, even if they contain unprocessed overweight messages.
     */
    MaxStale: PlainDescriptor<number>;
    /**
     * The amount of weight (if any) which should be provided to the message queue for
     * servicing enqueued items `on_initialize`.
     *
     * This may be legitimately `None` in the case that you will call
     * `ServiceQueues::service_queues` manually or set [`Self::IdleMaxServiceWeight`] to have
     * it run in `on_idle`.
     */
    ServiceWeight: PlainDescriptor<Anonymize<Iasb8k6ash5mjn>>;
    /**
     * The maximum amount of weight (if any) to be used from remaining weight `on_idle` which
     * should be provided to the message queue for servicing enqueued items `on_idle`.
     * Useful for parachains to process messages at the same block they are received.
     *
     * If `None`, it will not call `ServiceQueues::service_queues` in `on_idle`.
     */
    IdleMaxServiceWeight: PlainDescriptor<Anonymize<Iasb8k6ash5mjn>>;
  };
  PolkadotXcm: {
    /**
     * This chain's Universal Location.
     */
    UniversalLocation: PlainDescriptor<XcmV5Junctions>;
    /**
     * The latest supported version that we advertise. Generally just set it to
     * `pallet_xcm::CurrentXcmVersion`.
     */
    AdvertisedXcmVersion: PlainDescriptor<number>;
    /**
     * The maximum number of local XCM locks that a single account may have.
     */
    MaxLockers: PlainDescriptor<number>;
    /**
     * The maximum number of consumers a single remote lock may have.
     */
    MaxRemoteLockConsumers: PlainDescriptor<number>;
  };
  CollatorSelection: {
    /**
     * Account Identifier from which the internal Pot is generated.
     */
    PotId: PlainDescriptor<SizedHex<8>>;
    /**
     * Maximum number of candidates that we should have.
     *
     * This does not take into account the invulnerables.
     */
    MaxCandidates: PlainDescriptor<number>;
    /**
     * Minimum number eligible collators. Should always be greater than zero. This includes
     * Invulnerable collators. This ensures that there will always be one collator who can
     * produce a block.
     */
    MinEligibleCollators: PlainDescriptor<number>;
    /**
     * Maximum number of invulnerables.
     */
    MaxInvulnerables: PlainDescriptor<number>;
    /**
        
         */
    KickThreshold: PlainDescriptor<number>;
    /**
     * Gets this pallet's derived pot account.
     */
    pot_account: PlainDescriptor<SS58String>;
  };
  Session: {
    /**
     * The amount to be held when setting keys.
     */
    KeyDeposit: PlainDescriptor<bigint>;
  };
  Aura: {
    /**
     * The slot duration Aura should run with, expressed in milliseconds.
     *
     * The effective value of this type can be changed with a runtime upgrade.
     *
     * For backwards compatibility either use [`MinimumPeriodTimesTwo`] or a const.
     */
    SlotDuration: PlainDescriptor<bigint>;
  };
  Constitution: {
    /**
     * 02 §2/§8: `INTEGRATION_CONTRACT_VERSION`, metadata-readable,
     * canonical spelling per rule 5 (02 names byte-for-byte).
     */
    INTEGRATION_CONTRACT_VERSION: PlainDescriptor<number>;
    /**
     * 13 §4 bound on the genesis-fixed key set.
     */
    MaxParams: PlainDescriptor<number>;
    /**
     * Core bound on the capability table.
     */
    MaxCapabilities: PlainDescriptor<number>;
    /**
     * Core bound on the kernel meter set.
     */
    MaxMeters: PlainDescriptor<number>;
  };
  ConditionalLedger: {
    /**
     * `MinSplit = MinTransfer = ledger.min_split` (13 §1; K floor
     * `kernel::MIN_SPLIT_USDC`). Wired to `pallet-constitution::Params` in the
     * runtime; the core enforces the K floor as a backstop.
     */
    MinSplit: PlainDescriptor<bigint>;
    /**
     * `ledger.position_deposit = 0.1 USDC` per `Positions` entry (13 §4).
     */
    PositionDeposit: PlainDescriptor<bigint>;
    /**
     * `MaxPositionsPerAccount = 64`, counter-enforced for non-protocol
     * accounts (13 §4). The core enforces the same K value mid-op for atomicity.
     */
    MaxPositionsPerAccount: PlainDescriptor<number>;
    /**
     * `ledger.archive_delay` (13 §1, default 1 yr): a terminal vault is
     * reap-eligible only once this many blocks have elapsed since it settled.
     */
    ArchiveDelay: PlainDescriptor<number>;
    /**
     * `ReapBatch = 100` (13 §4): max `Positions` entries drained per
     * `sweep_dust*` call.
     */
    ReapBatch: PlainDescriptor<number>;
    /**
     * The ledger's own `PalletId`; its derived sovereign account custodies all
     * escrow and held deposits (03 §1).
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
        
         */
    MinTransfer: PlainDescriptor<bigint>;
    /**
     * 02 §9 (contract v17): the live `ledger.redeem_fee` projected to
     * **basis points** by flooring the raw `Perbill` divided by 100,000 —
     * the same projection `Market::Fee` publishes for `mkt.fee`, and the
     * value a frontend cross-checks against the raw scalar from `params()`
     * before displaying a net redemption payout.
     */
    RedemptionFee: PlainDescriptor<bigint>;
    /**
     * 02 §9 (contract v23): the kernel id-band boundary separating the
     * **primary** domain from the **service** domain (16 §7.1). One
     * number partitions every question, book, vault and position id, so
     * a consumer decides which ledger instance a row belongs to by a
     * single comparison against an id it already holds.
     *
     * Exposed here because 02 §9.4 forbids the frontend a chain literal
     * and 11 §11.2a requires it to render the domain: without a metadata
     * home the client would have to hardcode `1 << 63`, which is the one
     * thing that rule set does not permit. Both instances publish it and
     * the value is identical — it is a property of the id space, not of
     * either instance, and instancing it per side would invite exactly
     * the drift the single kernel constant exists to prevent.
     * `pub` where its siblings are private, deliberately: the runtime
     * suite asserts both instances publish the identical boundary, which
     * is a cross-instance property no in-pallet test can observe.
     */
    ServiceIdBase: PlainDescriptor<bigint>;
  };
  Market: {
    /**
     * `mkt.fee`, in basis points (13 §1).
     */
    Fee: PlainDescriptor<bigint>;
    /**
     * `mkt.obs_interval`, in blocks (13 §1).
     */
    ObsInterval: PlainDescriptor<bigint>;
    /**
     * `mkt.kappa`, represented on the 1e9 fixed grid (13 §1).
     */
    Kappa1e9: PlainDescriptor<bigint>;
    /**
     * Delay from close until permissionless reaping (04 §2).
     */
    ArchiveDelay: PlainDescriptor<number>;
    /**
     * Market sovereign account; also the ledger's configured MarketAuthority.
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
        
         */
    MinTrade: PlainDescriptor<bigint>;
    /**
        
         */
    MaxTradeRatio: PlainDescriptor<Anonymize<I9jd27rnpm8ttv>>;
    /**
        
         */
    MaxLiveMarkets: PlainDescriptor<number>;
    /**
        
         */
    MaxStoredMarkets: PlainDescriptor<number>;
    /**
        
         */
    MaxLiveExternalMarkets: PlainDescriptor<number>;
    /**
        
         */
    MaxStoredExternalMarkets: PlainDescriptor<number>;
    /**
        
         */
    MaxAllStoredMarkets: PlainDescriptor<number>;
    /**
        
         */
    GatePMaxCeiling: PlainDescriptor<bigint>;
    /**
        
         */
    GateEpsFloor: PlainDescriptor<bigint>;
  };
  Welfare: {
    /**
        
         */
    INTEGRATION_CONTRACT_VERSION: PlainDescriptor<number>;
    /**
        
         */
    MaxMetricSpecs: PlainDescriptor<number>;
    /**
        
         */
    MaxSnapshots: PlainDescriptor<number>;
    /**
        
         */
    MaxGateFlags: PlainDescriptor<number>;
    /**
        
         */
    MaxDailyGateSamples: PlainDescriptor<number>;
  };
  Oracle: {
    /**
     * Upper bound on rounds closed per `crank_round_close` call — a
     * keeper-batch cap that bounds the crank's PoV (07 §13 "bounded
     * batches"; not a 13 §1 tunable). Never hardcoded in the call body.
     */
    MaxRoundCloseBatch: PlainDescriptor<number>;
  };
  IncidentRegistry: {
    /**
     * This instance's registry discriminant (07 §7: `Incident` feeds
     * `C_attested`, `Milestone` feeds the A pillar).
     */
    Kind: PlainDescriptor<Anonymize<I7r7b6bp2g5acg>>;
    /**
     * This instance's `PalletId`; its derived sovereign account custodies all
     * escrowed filing bonds. Instances MUST use distinct ids.
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
     * The registry archive delay — a closed epoch is reap-eligible only once
     * this many blocks have elapsed since it closed, so welfare has consumed
     * its aggregate at snapshot time before the records are destroyed (07 §7
     * "reaped at cohort settlement + archive delay"). Prevents a griefer
     * erasing an incident before settlement. This is a `Get` the runtime
     * sources at B1a — reusing `ledger.archive_delay` (13 §1) or a new
     * `reg.archive_delay` key, a 13 decision pending (PLAN SQ-76); the code
     * hardcodes no literal (rule 4).
     */
    ArchiveDelay: PlainDescriptor<number>;
    /**
     * `reg.max_filings_epoch = 64` (13 §4, K). MUST equal the core's
     * [`registry_core::MAX_FILINGS_PER_EPOCH`]; pinned by `integrity_test`.
     */
    MaxFilingsPerEpoch: PlainDescriptor<number>;
    /**
     * Evidence is a 32-byte content hash only (07 §7 Config
     * `MaxEvidenceLen`); the on-chain object is a fixed [`H256`], so this
     * bound documents the contract surface (the runtime pins it to 32).
     */
    MaxEvidenceLen: PlainDescriptor<number>;
  };
  MilestoneRegistry: {
    /**
     * This instance's registry discriminant (07 §7: `Incident` feeds
     * `C_attested`, `Milestone` feeds the A pillar).
     */
    Kind: PlainDescriptor<Anonymize<I7r7b6bp2g5acg>>;
    /**
     * This instance's `PalletId`; its derived sovereign account custodies all
     * escrowed filing bonds. Instances MUST use distinct ids.
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
     * The registry archive delay — a closed epoch is reap-eligible only once
     * this many blocks have elapsed since it closed, so welfare has consumed
     * its aggregate at snapshot time before the records are destroyed (07 §7
     * "reaped at cohort settlement + archive delay"). Prevents a griefer
     * erasing an incident before settlement. This is a `Get` the runtime
     * sources at B1a — reusing `ledger.archive_delay` (13 §1) or a new
     * `reg.archive_delay` key, a 13 decision pending (PLAN SQ-76); the code
     * hardcodes no literal (rule 4).
     */
    ArchiveDelay: PlainDescriptor<number>;
    /**
     * `reg.max_filings_epoch = 64` (13 §4, K). MUST equal the core's
     * [`registry_core::MAX_FILINGS_PER_EPOCH`]; pinned by `integrity_test`.
     */
    MaxFilingsPerEpoch: PlainDescriptor<number>;
    /**
     * Evidence is a 32-byte content hash only (07 §7 Config
     * `MaxEvidenceLen`); the on-chain object is a fixed [`H256`], so this
     * bound documents the contract surface (the runtime pins it to 32).
     */
    MaxEvidenceLen: PlainDescriptor<number>;
  };
  FutarchyTreasury: {
    /**
     * 02 §2/§8: `INTEGRATION_CONTRACT_VERSION`, metadata-readable.
     */
    INTEGRATION_CONTRACT_VERSION: PlainDescriptor<number>;
    /**
     * 13 §4 bound on open vesting streams.
     */
    MaxStreams: PlainDescriptor<number>;
    /**
     * 13 §4 bound on budget lines.
     */
    MaxBudgetLines: PlainDescriptor<number>;
    /**
     * 13 §4 bound on POL commitments (= `MaxLiveMarkets`).
     */
    MaxPolCommitments: PlainDescriptor<number>;
    /**
     * 13 §4 bound on distinct collators retained for one payout.
     */
    MaxCollatorCompensationEntries: PlainDescriptor<number>;
  };
  Guardian: {
    /**
     * 06 §5.1: council size (7 seats).
     */
    GuardianSeats: PlainDescriptor<number>;
    /**
     * 06 §5.1: approval threshold (5-of-7).
     */
    GuardianThreshold: PlainDescriptor<number>;
    /**
     * 06 §5.1: per-member bond (50,000 VIT).
     */
    GuardianBond: PlainDescriptor<bigint>;
    /**
     * 06 §5.2/§6.2/§6.3: hard pallet-level effect backstop.
     */
    PlaybookFreezeWindowBlocks: PlainDescriptor<number>;
    /**
     * 06 §5.2 allowance table: `delay_once`, 2 per epoch.
     *
     * [`Allowances`] stores the *used* counter alone, so the limit a client
     * compares it against has no storage representation. 02 §9 freezes this
     * name for that comparison (13 §1 reading rule 3).
     */
    DelayOnceAllowancePerEpoch: PlainDescriptor<number>;
    /**
     * 06 §5.2 allowance table: `force_rerun`, 1 per epoch.
     */
    ForceRerunAllowancePerEpoch: PlainDescriptor<number>;
    /**
     * 06 §5.2 allowance table: the `pause_intake` window, 4 epochs. The
     * pair below is one allowance — `PauseIntakeAllowance` uses per
     * `PauseIntakeAllowanceWindowEpochs`-epoch window — so a client that
     * reads one without the other cannot render the meter.
     */
    PauseIntakeAllowanceWindowEpochs: PlainDescriptor<number>;
    /**
     * 06 §5.2 allowance table: `pause_intake`, 1 per window.
     */
    PauseIntakeAllowance: PlainDescriptor<number>;
  };
  Attestor: {
    /**
     * Kernel minimum registry size (06 §7; 13 §4).
     */
    AttMinMembers: PlainDescriptor<number>;
    /**
     * Kernel quorum (2-of-N; 06 §7; 13 §4).
     */
    AttQuorum: PlainDescriptor<number>;
    /**
     * Kernel floor envelope for live `att.window`: 43,200 blocks / 72 h
     * (02 §9(2); 13 rule 7). This is not the live tunable value.
     */
    ChallengeWindowBlocks: PlainDescriptor<number>;
  };
  Epoch: {
    /**
        
         */
    INTEGRATION_CONTRACT_VERSION: PlainDescriptor<number>;
    /**
     * 08 §7's TREASURY intake-bond Ask surcharge slope, in basis points
     * (02 §9, added in contract v13 — SQ-186).
     *
     * The class **base** is the governed `prop.bond.trs` Params row; this
     * slope is a kernel constant and deliberately *not* part of that row
     * (13 §1), because with no economic bounds to bind it governance could
     * otherwise walk the surcharge toward zero and weaken intake pricing
     * (R-7). Exposed so the frontend can compute a TREASURY bond from the
     * live base without hardcoding the slope.
     */
    TreasuryBondAskBps: PlainDescriptor<bigint>;
    /**
        
         */
    MaxLiveProposals: PlainDescriptor<number>;
    /**
        
         */
    MaxIntakeQueue: PlainDescriptor<number>;
    /**
        
         */
    MaxNonTerminalCohorts: PlainDescriptor<number>;
    /**
        
         */
    RecentCohortSummariesBound: PlainDescriptor<number>;
    /**
        
         */
    TickBatch: PlainDescriptor<number>;
    /**
        
         */
    PhaseOffsets: PlainDescriptor<Anonymize<I7rm113kjbo5gc>>;
    /**
        
         */
    MaxBooksPerProposal: PlainDescriptor<number>;
    /**
        
         */
    MinEpochLength: PlainDescriptor<number>;
    /**
        
         */
    DecisionWindowFloor: PlainDescriptor<number>;
    /**
        
         */
    DecisionExtension: PlainDescriptor<number>;
    /**
        
         */
    DecisionDeltaFloors: PlainDescriptor<Anonymize<I4totqt881mlti>>;
    /**
        
         */
    DecisionSigmaFloors: PlainDescriptor<Anonymize<I4totqt881mlti>>;
  };
  ExecutionGuard: {
    /**
        
         */
    MaxRuntimeCodeBytes: PlainDescriptor<number>;
    /**
        
         */
    INTEGRATION_CONTRACT_VERSION: PlainDescriptor<number>;
    /**
        
         */
    MaxLiveProposals: PlainDescriptor<number>;
    /**
        
         */
    MaxExecutionRecords: PlainDescriptor<number>;
    /**
        
         */
    MaxCalls: PlainDescriptor<number>;
    /**
        
         */
    MaxPayloadBytes: PlainDescriptor<number>;
    /**
        
         */
    DescriptorLeadTime: PlainDescriptor<number>;
    /**
        
         */
    ExecutionTimelockFloor: PlainDescriptor<Anonymize<I5pbtpcshc7f67>>;
    /**
        
         */
    ExecutionGraceFloor: PlainDescriptor<number>;
  };
  ClientRegistry: {
    /**
        
         */
    DeliveryAssetId: PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
    /**
     * Root for deterministic, disjoint per-client USDC escrow accounts.
     */
    DeliveryFloatPalletId: PlainDescriptor<SizedHex<8>>;
    /**
     * 13 §4's hard cap on simultaneous registered clients.
     */
    MaxClients: PlainDescriptor<number>;
    /**
     * Live optional admission bond. `None` is the intentional
     * calibration-pending state and is visible without inventing a zero.
     */
    ClientBond: PlainDescriptor<Anonymize<I35p85j063s0il>>;
  };
  QuestionService: {
    /**
     * Service-lifecycle sovereign. Distinct from both ledger sovereigns.
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
        
         */
    FeeFloor: PlainDescriptor<bigint>;
    /**
        
         */
    MaxLive: PlainDescriptor<number>;
    /**
        
         */
    MaxWindow: PlainDescriptor<number>;
    /**
        
         */
    EpsilonMin: PlainDescriptor<bigint>;
    /**
        
         */
    AttestorsMin: PlainDescriptor<number>;
  };
  ServiceLedger: {
    /**
     * `MinSplit = MinTransfer = ledger.min_split` (13 §1; K floor
     * `kernel::MIN_SPLIT_USDC`). Wired to `pallet-constitution::Params` in the
     * runtime; the core enforces the K floor as a backstop.
     */
    MinSplit: PlainDescriptor<bigint>;
    /**
     * `ledger.position_deposit = 0.1 USDC` per `Positions` entry (13 §4).
     */
    PositionDeposit: PlainDescriptor<bigint>;
    /**
     * `MaxPositionsPerAccount = 64`, counter-enforced for non-protocol
     * accounts (13 §4). The core enforces the same K value mid-op for atomicity.
     */
    MaxPositionsPerAccount: PlainDescriptor<number>;
    /**
     * `ledger.archive_delay` (13 §1, default 1 yr): a terminal vault is
     * reap-eligible only once this many blocks have elapsed since it settled.
     */
    ArchiveDelay: PlainDescriptor<number>;
    /**
     * `ReapBatch = 100` (13 §4): max `Positions` entries drained per
     * `sweep_dust*` call.
     */
    ReapBatch: PlainDescriptor<number>;
    /**
     * The ledger's own `PalletId`; its derived sovereign account custodies all
     * escrow and held deposits (03 §1).
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
        
         */
    MinTransfer: PlainDescriptor<bigint>;
    /**
     * 02 §9 (contract v17): the live `ledger.redeem_fee` projected to
     * **basis points** by flooring the raw `Perbill` divided by 100,000 —
     * the same projection `Market::Fee` publishes for `mkt.fee`, and the
     * value a frontend cross-checks against the raw scalar from `params()`
     * before displaying a net redemption payout.
     */
    RedemptionFee: PlainDescriptor<bigint>;
    /**
     * 02 §9 (contract v23): the kernel id-band boundary separating the
     * **primary** domain from the **service** domain (16 §7.1). One
     * number partitions every question, book, vault and position id, so
     * a consumer decides which ledger instance a row belongs to by a
     * single comparison against an id it already holds.
     *
     * Exposed here because 02 §9.4 forbids the frontend a chain literal
     * and 11 §11.2a requires it to render the domain: without a metadata
     * home the client would have to hardcode `1 << 63`, which is the one
     * thing that rule set does not permit. Both instances publish it and
     * the value is identical — it is a property of the id space, not of
     * either instance, and instancing it per side would invite exactly
     * the drift the single kernel constant exists to prevent.
     * `pub` where its siblings are private, deliberately: the runtime
     * suite asserts both instances publish the identical boundary, which
     * is a cross-instance property no in-pallet test can observe.
     */
    ServiceIdBase: PlainDescriptor<bigint>;
  };
  TradingRewards: {
    /**
        
         */
    UsdcAssetId: PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
    /**
     * Root of the pallet's own sovereign account, which custodies both the
     * USDC bonds and the authorized VIT budget.
     */
    PalletId: PlainDescriptor<SizedHex<8>>;
    /**
     * 13 §4's bound on the enrolled roster.
     */
    MaxParticipants: PlainDescriptor<number>;
    /**
     * 13 §4's bound on one account's unfolded score entries.
     */
    MaxScoredMarketsPerAccount: PlainDescriptor<number>;
  };
};
type IViewFns = {};
type IRuntimeCalls = {
  /**
   * The `Core` runtime api that every Substrate runtime needs to implement.
   */
  Core: {
    /**
     * Returns the version of the runtime.
     */
    version: RuntimeDescriptor<[], Anonymize<I4fo08joqmcqnm>>;
    /**
     * Execute the given block.
     */
    execute_block: RuntimeDescriptor<[block: Anonymize<Iaqet9jc3ihboe>], undefined>;
    /**
     * Initialize a block with the given header and return the runtime executive mode.
     */
    initialize_block: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], Anonymize<I2v50gu3s1aqk6>>;
  };
  /**
   * The `Metadata` api trait that returns metadata for the runtime.
   */
  Metadata: {
    /**
     * Returns the metadata of a runtime.
     */
    metadata: RuntimeDescriptor<[], Uint8Array>;
    /**
     * Returns the metadata at a given version.
     *
     * If the given `version` isn't supported, this will return `None`.
     * Use [`Self::metadata_versions`] to find out about supported metadata version of the runtime.
     */
    metadata_at_version: RuntimeDescriptor<[version: number], Anonymize<Iabpgqcjikia83>>;
    /**
     * Returns the supported metadata versions.
     *
     * This can be used to call `metadata_at_version`.
     */
    metadata_versions: RuntimeDescriptor<[], Anonymize<Icgljjb6j82uhn>>;
  };
  /**
   * Runtime API for executing view functions
   */
  RuntimeViewFunction: {
    /**
     * Execute a view function query.
     */
    execute_view_function: RuntimeDescriptor<[query_id: Anonymize<I4gil44d08grh>, input: Uint8Array], Anonymize<I7u915mvkdsb08>>;
  };
  /**
   * The frozen Bleavit read-only runtime API (02 §3).
   */
  FutarchyApi: {
    /**
     * Epoch clock: index, phase, boundaries, dead-man, freeze and phase flags.
     */
    epoch_status: RuntimeDescriptor<[], Anonymize<I7g3jnj59cuc3k>>;
    /**
     * All live proposals with market ids, states, decide_at, maturity, ratification.
     */
    proposal_summaries: RuntimeDescriptor<[], Anonymize<I3nir9l71btsd5>>;
    /**
     * Exact quote incl. fee for a hypothetical trade at current book state (USDC-denominated, D-3 wrapper semantics).
     */
    quote: RuntimeDescriptor<[market: bigint, side: Anonymize<Ib4c4hbfg3ril4>, amount: bigint], Anonymize<I6bep0s8nf1jn4>>;
    /**
     * Finalized decision statistics from sealed registered windows (incl. D-4 sizing).
     */
    decision_stats: RuntimeDescriptor<[pid: bigint], Anonymize<Idbhri2uj6av22>>;
    /**
     * All positions of an account across proposal, gate and Baseline instruments.
     */
    account_positions: RuntimeDescriptor<[who: SizedHex<32>], Anonymize<Ietccudq8ucajb>>;
    /**
     * Execution queue incl. maturity/grace/version/ratification state.
     */
    execution_queue: RuntimeDescriptor<[], Anonymize<I3fvgo362krtrr>>;
    /**
     * Current welfare pillars, gates, breach + reserve flags, active MetricSpec.
     */
    welfare_current: RuntimeDescriptor<[], Anonymize<Ifi0c8r8eomqru>>;
    /**
     * Typed constitution params (value + bounds + governance metadata) for ≤ 64 keys.
     */
    params: RuntimeDescriptor<[keys: Anonymize<I6tacm14gh0jtv>], Anonymize<Ibe056naqv5jeg>>;
    /**
     * Treasury NAV components (matches the treasury definition in 08), incl. haircut flag.
     */
    nav: RuntimeDescriptor<[], Anonymize<Idq3lmpdqfuf91>>;
    /**
     * Ring of the last 32 cohort settlements (mirrors RecentCohortSummaries, §7.1).
     */
    recent_cohorts: RuntimeDescriptor<[], Anonymize<I1qevohso20t15>>;
    /**
     * Oracle rounds currently open.
     */
    open_oracle_rounds: RuntimeDescriptor<[], Anonymize<I8s95j32t1rrnr>>;
    /**
     * Immutable hosted report, available from `Sealed` through archive.
     */
    hosted_report: RuntimeDescriptor<[question_id: bigint], Anonymize<If9jrft6hbnnq>>;
    /**
     * All positions of an account in the service ledger domain
     * (`ServiceLedger` = `pallet_conditional_ledger::<Instance1>`, 02 §7.1).
     *
     * Deliberately separate from [`FutarchyApi::account_positions`] rather than
     * merged into it: `MAX_ACCOUNT_POSITIONS` is enforced per account *per
     * instance*, so both domains can be simultaneously full and one shared
     * return vector would truncate a user's real holdings (02 §3, v23).
     */
    service_positions: RuntimeDescriptor<[who: SizedHex<32>], Anonymize<Ietccudq8ucajb>>;
    /**
     * Whether an account is a **reserved protocol destination** — the exact
     * predicate `ledger.transfer` refuses on (02 §3, v25).
     *
     * This is the chain read behind 11 §11.5's P-9 clause, and it is a method
     * rather than a published derivation for one reason: §11.4 rule 2 requires
     * every precondition row to be *an exact chain read*, and a client that
     * recomputed the predicate from frozen constants would be evaluating a
     * computation. The distinction is the same one that made
     * `ConditionalLedger::ServiceIdBase` correctly a metadata constant — that
     * classifies a datum the client already holds; this asks the chain a
     * question about an address the user just typed.
     *
     * Deliberately **not** `MarketProtocolAccounts::contains_key`. That index is
     * ownership/refcount state for deposit exemption and is strictly narrower:
     * classification does not depend on it, because every canonical
     * future/present/past book address is reserved by namespace whether or not a
     * book currently references it (SQ-588). A client bound to the narrower
     * predicate would pass a row the runtime then refuses.
     */
    is_reserved_protocol_destination: RuntimeDescriptor<[who: SizedHex<32>], boolean>;
    /**
     * What a **not-yet-created** bonded action would hold, priced at the
     * current block (02 §3/§4, contract v29; 07 §6.1, §7).
     *
     * One method for both bonds, because 07 states **one** fold under two
     * names: `StakeAtRisk(c, m)` and `Exposure(kind, m)` are the same sum of
     * `CohortEscrow(k)` over live cohort schedules, differing only in which
     * cohorts are in scope. Two methods would publish it twice and let the
     * copies drift.
     *
     * It returns the **amount**, not the ingredients. 07 §6.1 states three
     * separable normative details — the `/ 10,000` division rounds up,
     * rounding resolves toward custody, and the `max` against the floor
     * applies after rounding — and a client applying them itself would own
     * them. Under-collateralizing a bond is the under-custody direction
     * (I-4 / I-28), and this is money a user must post. The challenge side
     * is already symmetric: it reads `OracleRoundView.bond`, the chain's own
     * frozen figure.
     *
     * `None` is a **first-class answer**, not an error: 07 §7 makes the
     * Milestone exposure not determinable until the aggregate is bound to a
     * component, and `file` MUST then refuse with `ExposureUnavailable` —
     * the status-quo default (G-1). A client receiving `None` blocks.
     */
    bond_quote: RuntimeDescriptor<[request: Anonymize<I4ujid8kn88isk>], Anonymize<Idu551939jhadj>>;
    /**
     * Every outbound treasury stream whose recipient is `who`, each with the
     * exact amount `futarchy_treasury.claim_stream` would pay now
     * (02 §3/§4, contract v29; 11 §11.8.3).
     *
     * A per-caller projection rather than frozen `pallet-futarchy-treasury`
     * storage, and that **preserves** §7.6's closing rule rather than
     * carving into it: the rule forbids binding *raw storage*, and a
     * published runtime-API projection is not raw storage — `nav()` is
     * itself one. It also keeps 11 §11.4 rule 2's exact-chain-read
     * property, which a stated exception would give up.
     */
    treasury_streams: RuntimeDescriptor<[who: SizedHex<32>], Anonymize<I9fgo4t9o7trj7>>;
  };
  /**
   * Monitoring-only telemetry API owned by 12 §6.3, outside contract 02.
   */
  TelemetryApi: {
    /**
     * Per-live-book realized loss and its identically labeled LMSR bound.
     */
    market_books: RuntimeDescriptor<[], Anonymize<I607t5e3e5mnk5>>;
    /**
     * Every currently active, unsealed decision window.
     */
    mid_window_coverage: RuntimeDescriptor<[], Anonymize<Ie8c3gf89pirvk>>;
    /**
     * POL and Baseline funding compared independently to their matching requirements.
     */
    pol: RuntimeDescriptor<[], Anonymize<Idt3pdmk8m17j6>>;
    /**
     * Ledger L-2 custody and liability, plus the anomalous positive residue component.
     */
    collateral: RuntimeDescriptor<[], Anonymize<I8fksma6odit5g>>;
    /**
     * Service-ledger L-2 custody and liability, independently audited for I-37.
     */
    service_collateral: RuntimeDescriptor<[], Anonymize<I8fksma6odit5g>>;
    /**
     * Live USDC balance of the local `ops.reserve_probe` budget line.
     */
    reserve_probe_line_balance: RuntimeDescriptor<[], bigint>;
    /**
     * Canonical PB-MIGRATION cursor-stall detector state.
     */
    migration_cursor_stalled: RuntimeDescriptor<[], boolean>;
    /**
     * Metadata-invisible bounded collection occupancy rows.
     */
    storage_utilization: RuntimeDescriptor<[], Anonymize<I996aiv3qoehvi>>;
    /**
     * Bounded, sorted client push counters; explicitly non-welfare.
     */
    service_egress: RuntimeDescriptor<[], Anonymize<I4fj3mptf3jr0q>>;
    /**
     * 16 §8.4 cannibalization falsifier + §8.5 partition occupancy (N7).
     */
    service_partition: RuntimeDescriptor<[], Anonymize<Ibh9utbkad113n>>;
  };
  /**
   * Release-only proof surface owned by architecture 12 §1.
   */
  ReleaseMetadataApi: {
    /**
     * Digest embedded in the running Wasm's `CheckMetadataHash` extension.
     * `None` is the fail-closed result for a non-release build.
     */
    embedded_rfc78_metadata_hash: RuntimeDescriptor<[], Anonymize<I4s6vifaf8k998>>;
  };
  /**
   * The `BlockBuilder` api trait that provides the required functionality for building a block.
   */
  BlockBuilder: {
    /**
     * Apply the given extrinsic.
     *
     * Returns an inclusion outcome which specifies if this extrinsic is included in
     * this block or not.
     */
    apply_extrinsic: RuntimeDescriptor<[extrinsic: Uint8Array], Anonymize<Id5433fsuakfsh>>;
    /**
     * Finish the current block.
     */
    finalize_block: RuntimeDescriptor<[], Anonymize<Ic952bubvq4k7d>>;
    /**
     * Generate inherent extrinsics. The inherent data will vary from chain to chain.
     */
    inherent_extrinsics: RuntimeDescriptor<[inherent: Anonymize<If7uv525tdvv7a>], Anonymize<Itom7fk49o0c9>>;
    /**
     * Check that the inherents are valid. The inherent data will vary from chain to chain.
     */
    check_inherents: RuntimeDescriptor<[block: Anonymize<Iaqet9jc3ihboe>, data: Anonymize<If7uv525tdvv7a>], Anonymize<I2an1fs2eiebjp>>;
  };
  /**
   * The `TaggedTransactionQueue` api trait for interfering with the transaction queue.
   */
  TaggedTransactionQueue: {
    /**
     * Validate the transaction.
     *
     * This method is invoked by the transaction pool to learn details about given transaction.
     * The implementation should make sure to verify the correctness of the transaction
     * against current state. The given `block_hash` corresponds to the hash of the block
     * that is used as current state.
     *
     * Note that this call may be performed by the pool multiple times and transactions
     * might be verified in any possible order.
     */
    validate_transaction: RuntimeDescriptor<[source: TransactionValidityTransactionSource, tx: Uint8Array, block_hash: SizedHex<32>], Anonymize<I9ask1o4tfvcvs>>;
  };
  /**
   * The offchain worker api.
   */
  OffchainWorkerApi: {
    /**
     * Starts the off-chain task for given block header.
     */
    offchain_worker: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], undefined>;
  };
  /**
   * Session keys runtime api.
   */
  SessionKeys: {
    /**
     * Generate a set of session keys with optionally using the given seed.
     * The keys should be stored within the keystore exposed via runtime
     * externalities.
     *
     * The seed needs to be a valid `utf8` string.
     *
     * Returns the concatenated SCALE encoded public keys.
     */
    generate_session_keys: RuntimeDescriptor<[owner: Uint8Array, seed: Anonymize<Iabpgqcjikia83>], Anonymize<I4ph3d1eepnmr1>>;
    /**
     * Decode the given public session keys.
     *
     * Returns the list of public raw public keys + key type.
     */
    decode_session_keys: RuntimeDescriptor<[encoded: Uint8Array], Anonymize<Icerf8h8pdu8ss>>;
  };
  /**
   * API necessary for block authorship with aura.
   */
  AuraApi: {
    /**
     * Returns the slot duration for Aura.
     *
     * Currently, only the value provided by this type at genesis will be used.
     */
    slot_duration: RuntimeDescriptor<[], bigint>;
    /**
     * Return the current set of authorities.
     */
    authorities: RuntimeDescriptor<[], Anonymize<Ic5m5lp1oioo8r>>;
  };
  /**
   * This runtime API is used to inform potential block authors whether they will
   * have the right to author at a slot, assuming they have claimed the slot.
   *
   * In particular, this API allows Aura-based parachains to regulate their "unincluded segment",
   * which is the section of the head of the chain which has not yet been made available in the
   * relay chain.
   *
   * When the unincluded segment is short, Aura chains will allow authors to create multiple
   * blocks per slot in order to build a backlog. When it is saturated, this API will limit
   * the amount of blocks that can be created.
   *
   * Changes:
   * - Version 2: Update to `can_build_upon` to take a relay chain `Slot` instead of a parachain `Slot`.
   */
  AuraUnincludedSegmentApi: {
    /**
     * Whether it is legal to extend the chain, assuming the given block is the most
     * recently included one as-of the relay parent that will be built against, and
     * the given relay chain slot.
     *
     * This should be consistent with the logic the runtime uses when validating blocks to
     * avoid issues.
     *
     * When the unincluded segment is empty, i.e. `included_hash == at`, where at is the block
     * whose state we are querying against, this must always return `true` as long as the slot
     * is more recent than the included block itself.
     */
    can_build_upon: RuntimeDescriptor<[included_hash: SizedHex<32>, slot: bigint], boolean>;
  };
  /**
   * API to tell the node side how the relay parent should be chosen and how claim queue
   * offsets are determined.
   *
   * A larger relay parent offset indicates that the relay parent should not be the tip of
   * the relay chain, but `N` blocks behind the tip. This offset is then enforced by the
   * runtime.
   *
   * The max claim queue offset determines how far "into the future" collators target when
   * selecting cores from the claim queue. This provides async backing flexibility while
   * preventing collators from skipping slots.
   * See: <https://github.com/paritytech/polkadot-sdk/issues/8893>
   *
   * Version history:
   * - Version 1: Initial version with `relay_parent_offset` only
   * - Version 2: Added `max_claim_queue_offset` method
   */
  RelayParentOffsetApi: {
    /**
     * Fetch the relay parent offset that is expected from the relay chain.
     *
     * This determines how many blocks behind the relay chain tip the relay parent should be.
     */
    relay_parent_offset: RuntimeDescriptor<[], number>;
    /**
     * Maximum claim queue offset for async backing flexibility.
     *
     * Bounds how far "into the future" a candidate may look in the claim queue when
     * selecting a core. The effective claim queue depth depends on the candidate version:
     *
     * - **V1/V2 candidates**: the claim queue is looked up at the candidate's `relay_parent`,
     * which is `relay_parent_offset` blocks behind the relay-chain tip. The effective
     * depth is `relay_parent_offset + max_claim_queue_offset`.
     *
     * - **V3 candidates**: the claim queue is looked up at the candidate's
     * `scheduling_parent` — the relay-chain block of the *last finished* slot, decoupled
     * from the execution-context `relay_parent`. The effective depth is just
     * `max_claim_queue_offset`.
     *
     * Collators select a core via an offset in `[0, max_claim_queue_offset]`.
     *
     * - **V2 candidates**: `max_claim_queue_offset = 1` is sufficient. The claim queue is
     * looked up at `relay_parent`, which sits behind the tip. Offset 0 covers synchronous
     * backing in the next relay block; offset 1 covers asynchronous backing in the relay
     * block after that.
     *
     * - **V3 candidates**: offset 0 is not reachable — the `scheduling_parent`
     * is usually the leaf when picked, but its child is already being built, so there is
     * no opportunity to land in the next relay block. Offset 1 is reachable under
     * synchronous-backing semantics. For elastic scaling the last block in the bundle is
     * built near the end of the current slot, which makes offset 1 too tight —
     * `max_claim_queue_offset = 2` is the minimum cap that keeps elastic scaling viable.
     *
     * Note: this method was added in `api_version = 2`. Collators calling on runtimes that
     * only implement `api_version = 1` of [`RelayParentOffsetApi`] will receive an error
     * and should fall back to a sensible default (current collator defaults: `1` on the
     * V3 path, `0` on the V1/V2 path).
     *
     * See: <https://github.com/paritytech/polkadot-sdk/issues/8893>
     */
    max_claim_queue_offset: RuntimeDescriptor<[], number>;
  };
  /**
   * Runtime api used to access general info about a parachain runtime.
   */
  GetParachainInfo: {
    /**
     * Retrieve the parachain id used for runtime.
     */
    parachain_id: RuntimeDescriptor<[], number>;
  };
  /**
   * API for specifying which relay chain storage data to include in storage proofs.
   *
   * This API allows parachains to request both top-level relay chain storage keys
   * and child trie storage keys to be included in the relay chain state proof.
   */
  KeyToIncludeInRelayProof: {
    /**
     * Returns relay chain storage proof requests.
     *
     * The collator will include them in the relay chain proof that is passed alongside the parachain inherent into the runtime.
     */
    keys_to_prove: RuntimeDescriptor<[], Anonymize<I15h4jnb8b841p>>;
  };
  /**
   * The API to query account nonce.
   */
  AccountNonceApi: {
    /**
     * Get current account nonce of given `AccountId`.
     */
    account_nonce: RuntimeDescriptor<[account: SS58String], number>;
  };
  /**
    
     */
  TransactionPaymentApi: {
    /**
        
         */
    query_info: RuntimeDescriptor<[uxt: Uint8Array, len: number], Anonymize<I6spmpef2c7svf>>;
    /**
        
         */
    query_fee_details: RuntimeDescriptor<[uxt: Uint8Array, len: number], Anonymize<Iei2mvq0mjvt81>>;
    /**
        
         */
    query_weight_to_fee: RuntimeDescriptor<[weight: Anonymize<I4q39t5hn830vp>], bigint>;
    /**
        
         */
    query_length_to_fee: RuntimeDescriptor<[length: number], bigint>;
  };
  /**
    
     */
  TransactionPaymentCallApi: {
    /**
     * Query information of a dispatch class, weight, and fee of a given encoded `Call`.
     */
    query_call_info: RuntimeDescriptor<[call: Anonymize<I3hev30cis3ndu>, len: number], Anonymize<I6spmpef2c7svf>>;
    /**
     * Query fee details of a given encoded `Call`.
     */
    query_call_fee_details: RuntimeDescriptor<[call: Anonymize<I3hev30cis3ndu>, len: number], Anonymize<Iei2mvq0mjvt81>>;
    /**
     * Query the output of the current `WeightToFee` given some input.
     */
    query_weight_to_fee: RuntimeDescriptor<[weight: Anonymize<I4q39t5hn830vp>], bigint>;
    /**
     * Query the output of the current `LengthToFee` given some input.
     */
    query_length_to_fee: RuntimeDescriptor<[length: number], bigint>;
  };
  /**
   * Runtime api to collect information about a collation.
   *
   * Version history:
   * - Version 2: Changed [`Self::collect_collation_info`] signature
   * - Version 3: Signals to the node to use version 1 of [`ParachainBlockData`].
   */
  CollectCollationInfo: {
    /**
     * Collect information about a collation.
     *
     * The given `header` is the header of the built block for that
     * we are collecting the collation info for.
     */
    collect_collation_info: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], Anonymize<Ic1d4u2opv3fst>>;
  };
  /**
   * API to interact with `RuntimeGenesisConfig` for the runtime
   */
  GenesisBuilder: {
    /**
     * Build `RuntimeGenesisConfig` from a JSON blob not using any defaults and store it in the
     * storage.
     *
     * In the case of a FRAME-based runtime, this function deserializes the full
     * `RuntimeGenesisConfig` from the given JSON blob and puts it into the storage. If the
     * provided JSON blob is incorrect or incomplete or the deserialization fails, an error
     * is returned.
     *
     * Please note that provided JSON blob must contain all `RuntimeGenesisConfig` fields, no
     * defaults will be used.
     */
    build_state: RuntimeDescriptor<[json: Uint8Array], Anonymize<Ie9sr1iqcg3cgm>>;
    /**
     * Returns a JSON blob representation of the built-in `RuntimeGenesisConfig` identified by
     * `id`.
     *
     * If `id` is `None` the function should return JSON blob representation of the default
     * `RuntimeGenesisConfig` struct of the runtime. Implementation must provide default
     * `RuntimeGenesisConfig`.
     *
     * Otherwise function returns a JSON representation of the built-in, named
     * `RuntimeGenesisConfig` preset identified by `id`, or `None` if such preset does not
     * exist. Returned `Vec<u8>` contains bytes of JSON blob (patch) which comprises a list of
     * (potentially nested) key-value pairs that are intended for customizing the default
     * runtime genesis config. The patch shall be merged (rfc7386) with the JSON representation
     * of the default `RuntimeGenesisConfig` to create a comprehensive genesis config that can
     * be used in `build_state` method.
     */
    get_preset: RuntimeDescriptor<[id: Anonymize<I1mqgk2tmnn9i2>], Anonymize<Iabpgqcjikia83>>;
    /**
     * Returns a list of identifiers for available builtin `RuntimeGenesisConfig` presets.
     *
     * The presets from the list can be queried with [`GenesisBuilder::get_preset`] method. If
     * no named presets are provided by the runtime the list is empty.
     */
    preset_names: RuntimeDescriptor<[], Anonymize<I6lr8sctk0bi4e>>;
  };
};
export type Bleavit_recoveryDispatchError = Anonymize<Idmmv2hj79l5es>;
type IAsset = PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
export type Bleavit_recoveryExtensions = {};
type PalletsTypedef = { __storage: IStorage; __tx: ICalls; __event: IEvent; __error: IError; __const: IConstants; __view: IViewFns };
export type Bleavit_recovery = { descriptors: { pallets: PalletsTypedef; apis: IRuntimeCalls } & Promise<any>; metadataTypes: Promise<Uint8Array>; asset: IAsset; extensions: Bleavit_recoveryExtensions; getMetadata: () => Promise<Uint8Array>; genesis: string | undefined };
declare const _allDescriptors: Bleavit_recovery;
export default _allDescriptors;
export type Bleavit_recoveryApis = ApisFromDef<IRuntimeCalls>;
export type Bleavit_recoveryQueries = QueryFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryCalls = TxFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryEvents = EventsFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryErrors = ErrorsFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryConstants = ConstFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryViewFns = ViewFnsFromPalletsDef<PalletsTypedef>;
export type Bleavit_recoveryCallData = Anonymize<I3hev30cis3ndu> & { value: { type: string } };
type AllInteractions = { storage: { System: ["Account", "ExtrinsicCount", "InherentsApplied", "BlockWeight", "BlockSize", "BlockHash", "ExtrinsicData", "Number", "ParentHash", "Digest", "Events", "EventCount", "EventTopics", "LastRuntimeUpgrade", "BlocksTillUpgrade", "UpgradedToU32RefCount", "UpgradedToTripleRefCount", "ExecutionPhase", "AuthorizedUpgrade", "ExtrinsicWeightReclaimed"]; Timestamp: ["Now", "DidUpdate"]; ParachainSystem: ["BlockWeightMode", "PreviousCoreCount", "UnincludedSegment", "AggregatedUnincludedSegment", "PendingValidationCode", "NewValidationCode", "ValidationData", "DidSetValidationCode", "LastRelayChainBlockNumber", "UpgradeRestrictionSignal", "UpgradeGoAhead", "RelayStateProof", "RelevantMessagingState", "HostConfiguration", "LastDmqMqcHead", "LastHrmpMqcHeads", "ProcessedDownwardMessages", "LastProcessedDownwardMessage", "HrmpWatermark", "LastProcessedHrmpMessage", "HrmpOutboundMessages", "UpwardMessages", "PendingUpwardMessages", "PendingUpwardSignals", "PendingApprovedPeer", "UpwardDeliveryFeeFactor", "AnnouncedHrmpMessagesPerCandidate", "ReservedXcmpWeightOverride", "ReservedDmpWeightOverride", "CustomValidationHeadData", "PoVMessagesTracker"]; ParachainInfo: ["ParachainId"]; Balances: ["TotalIssuance", "InactiveIssuance", "Account", "Locks", "Reserves", "Holds", "Freezes"]; ForeignAssets: ["Asset", "Account", "Approvals", "Metadata", "Reserves", "NextAssetId"]; TransactionPayment: ["NextFeeMultiplier", "StorageVersion", "TxPaymentCredit"]; Vesting: ["Vesting", "StorageVersion"]; Referenda: ["ReferendumCount", "ReferendumInfoFor", "TrackQueue", "DecidingCount", "MetadataOf"]; ConvictionVoting: ["VotingFor", "ClassLocksFor"]; Preimage: ["StatusFor", "RequestStatusFor", "PreimageFor"]; Scheduler: ["IncompleteSince", "Agenda", "Retries", "Lookup"]; Proxy: ["Proxies", "Announcements"]; Multisig: ["Multisigs"]; Migrations: ["Cursor", "Historic"]; Sudo: ["Key"]; XcmpQueue: ["InboundXcmpSuspended", "OutboundXcmpStatus", "OutboundXcmpMessages", "SignalMessages", "QueueConfig", "QueueSuspended", "DeliveryFeeFactor"]; MessageQueue: ["BookStateFor", "ServiceHead", "Pages"]; PolkadotXcm: ["QueryCounter", "Queries", "AssetTraps", "SafeXcmVersion", "SupportedVersion", "VersionNotifiers", "VersionNotifyTargets", "VersionDiscoveryQueue", "CurrentMigration", "RemoteLockedFungibles", "LockedFungibles", "XcmExecutionSuspended", "ShouldRecordXcm", "RecordedXcm", "AuthorizedAliases"]; Authorship: ["Author"]; CollatorSelection: ["Invulnerables", "CandidateList", "LastAuthoredBlock", "DesiredCandidates", "CandidacyBond"]; Session: ["Validators", "CurrentIndex", "QueuedChanged", "QueuedKeys", "DisabledValidators", "NextKeys", "KeyOwner", "ExternallySetKeys"]; Aura: ["Authorities", "CurrentSlot"]; AuraExt: ["Authorities", "RelaySlotInfo"]; Constitution: ["Params", "CounterForParams", "PhaseFlags", "ReleaseChannel", "Meters", "Capabilities"]; ConditionalLedger: ["Vaults", "BaselineVaults", "Positions", "PositionCount", "PositionTotals", "DepositsHeld", "TotalEscrowed", "RedemptionFeesAccrued", "LedgerDrifted", "LastReconciliation", "VaultTerminalAt", "BaselineTerminalAt", "SplitPausedUntil", "FrozenUntil", "FreezeRenewed"]; Market: ["Markets", "CounterForMarkets", "ActiveMarketCount", "ActiveExternalMarketCount", "StoredExternalMarketCount", "ExternalBookPairs", "CounterForExternalBookPairs", "MarketProtocolAccounts", "CounterForMarketProtocolAccounts", "ProposalMarketIds", "BaselineMarketOf", "SealedBaselineTwap", "ClosedAt", "SeededMarkets", "SweptMarkets", "NextMarketId", "TwapCheckpoints", "DecisionWindows", "DecisionWindowOwners", "RerunSeededMarkets", "SettlementObservedAt", "LivePolCommitments", "CreationFrozenUntil", "FrozenUntil", "FreezeRenewed"]; Welfare: ["MetricSpecs", "Snapshots", "SnapshotContexts", "SnapshotDeadline", "GateBreachFlags", "SampledGateDays", "XcmTraffic", "XcmTrafficEpochs", "ReserveProbeDaily", "CollatorAuthorship", "CollatorAuthorshipEpoch", "BlockProduction", "BlockProductionEpoch", "BlockWeightSamples", "PrimaryBlockWeightSamples", "BlockResourceUsage", "IntegrityFailures"]; Oracle: ["Reporters", "CounterForReporters", "Watchtowers", "CounterForWatchtowers", "Rounds", "RoundSchedules", "ComponentValues", "ReserveHealth", "ReserveProbeArmed", "ReserveProbeArmedAt", "AckRecords", "WatchtowerActive", "MoneySettled", "ReporterRecords", "RoundActivity", "Recomputable"]; IncidentRegistry: ["Filings", "FilingCount", "Aggregates", "AckRecords", "ClosedAt"]; MilestoneRegistry: ["Filings", "FilingCount", "Aggregates", "AckRecords", "ClosedAt"]; FutarchyTreasury: ["State", "PendingMainCredit", "SweptResidueUnreclaimed", "CoretimeQuoteAuthority", "BootstrapOpsFundingClosed", "CommunityDistributionArmedAt", "CommunityDistributionRemaining", "CommunityScheduleCount", "IncentiveRemaining", "TradingRewardBudgetCount", "CoretimeRenewalAccount", "CollatorAuthoredBlocks", "CollatorAuthoredEpoch", "CollatorAuthoredRegisteredCount", "CollatorPendingBlocks", "CollatorPendingEpoch", "CollatorPendingRegisteredCount", "CollatorAuthoredOverflowed", "CollatorPendingOverflowed", "CollatorDroppedEpoch", "CollatorCompensationPaidEpoch"]; Guardian: ["Members", "MemberBonds", "PendingActions", "Approvals", "ReviewDeadlines", "ActivePlaybooks", "PlaybookRegistered", "RerunUsed", "Allowances", "NextActionId", "LastSeenEpoch", "ReviewReferenda", "VetoReviewReferenda", "CounterForVetoReviewReferenda", "VetoReviewActions", "CounterForVetoReviewActions", "ReviewFrontingOf", "CounterForReviewFrontingOf", "PendingBondReleases", "FailedActions", "CounterForFailedActions", "MaintenanceSweepCursor", "FailedActionReapCursor"]; Attestor: ["Members", "Attestations", "Liabilities", "Revocations", "NextAttestationId"]; Epoch: ["Proposals", "CounterForProposals", "EpochOf", "IntakeQueue", "RecentCohortSummaries", "Cohorts", "CounterForCohorts", "IntakeProposals", "CounterForIntakeProposals", "Schedule", "EpochTimings", "GuardianReviewDeadlines", "CounterForGuardianReviewDeadlines", "GuardianReviewWindows", "CounterForGuardianReviewWindows", "QualificationPreimageRequests", "CounterForQualificationPreimageRequests", "QualificationAuxiliaryPreimageRequests", "CounterForQualificationAuxiliaryPreimageRequests", "ProposalSecurityTermsOf", "CounterForProposalSecurityTermsOf", "ProposalBonds", "CounterForProposalBonds", "ResourceLocks", "ProposalSchedules", "CohortSchedules", "NextProposalId", "RolloverCounts", "FundedPolSlots", "DeadMan", "LastRelayParent", "DeadManDetector", "StaleEpochCutoff", "BaselineCarry", "IntakePausedUntil", "GuardianIntakePausedUntil", "PendingOracleVoids", "CounterForPendingOracleVoids", "LastWatchtowerSweep", "OracleDeadlineCursor"]; ExecutionGuard: ["Queue", "CounterForQueue", "Ratifications", "CounterForRatifications", "PendingRatifications", "CounterForPendingRatifications", "ExecutionRecords", "PendingUpgrade", "CurrentSpecName", "HeldResources", "HardGateBreach", "DeadManFreeze", "MigrationHalt", "GateSuspension", "Expedited", "LastUpgradeAuthorized", "UpgradeSpacingHistory", "PendingAnchorCapture", "PreMigrationAnchor", "ScheduledUpgrade", "AttestationBindings", "RecoveryImage", "QueuedRecoveryImages", "QualifiedRecoveryImages", "CounterForQualifiedRecoveryImages", "RerunRecoveryPins", "CounterForRerunRecoveryPins", "ExecutingUpgrade", "PhaseFourBridge", "RerunPins", "CounterForRerunPins"]; InflowCaps: ["CumulativeDeposits"]; ClientRegistry: ["Clients", "ClientIdOf", "ClientIdOfSigner", "ClientPolicies", "BondOwners", "RemovedClients", "IngressMeters", "ClientCount", "NextClientId"]; QuestionService: ["Questions", "CounterForQuestions", "Reports", "Terms", "AttestorBonds", "Attestations", "PauseAffected", "PauseQuestionCutoff", "PausedUntil", "NextServiceId", "LiveQuestionCount", "LiveExternalDepth", "ScarcityMultiplier"]; ServiceLedger: ["Vaults", "BaselineVaults", "Positions", "PositionCount", "PositionTotals", "DepositsHeld", "TotalEscrowed", "RedemptionFeesAccrued", "LedgerDrifted", "LastReconciliation", "VaultTerminalAt", "BaselineTerminalAt", "SplitPausedUntil", "FrozenUntil", "FreezeRenewed"]; TradingRewards: ["Participants", "Scores", "ScoreCount", "ParticipantCount", "TotalAccrued"] }; tx: { System: ["remark", "set_heap_pages", "set_code", "set_code_without_checks", "set_storage", "kill_storage", "kill_prefix", "remark_with_event", "authorize_upgrade", "authorize_upgrade_without_checks", "apply_authorized_upgrade"]; Timestamp: ["set"]; ParachainSystem: ["set_validation_data", "sudo_send_upward_message"]; Balances: ["transfer_allow_death", "force_transfer", "transfer_keep_alive", "transfer_all", "force_unreserve", "upgrade_accounts", "force_set_balance", "force_adjust_total_issuance", "burn"]; ForeignAssets: ["create", "force_create", "start_destroy", "destroy_accounts", "destroy_approvals", "finish_destroy", "mint", "burn", "transfer", "transfer_keep_alive", "force_transfer", "freeze", "thaw", "freeze_asset", "thaw_asset", "transfer_ownership", "set_team", "set_metadata", "clear_metadata", "force_set_metadata", "force_clear_metadata", "force_asset_status", "approve_transfer", "cancel_approval", "force_cancel_approval", "transfer_approved", "touch", "refund", "set_min_balance", "touch_other", "refund_other", "block", "transfer_all", "set_reserves"]; Vesting: ["vest", "vest_other", "vested_transfer", "force_vested_transfer", "merge_schedules", "force_remove_vesting_schedule"]; Referenda: ["submit", "place_decision_deposit", "refund_decision_deposit", "cancel", "kill", "nudge_referendum", "one_fewer_deciding", "refund_submission_deposit", "set_metadata"]; ConvictionVoting: ["vote", "delegate", "undelegate", "unlock", "remove_vote", "remove_other_vote"]; Preimage: ["note_preimage", "unnote_preimage", "request_preimage", "unrequest_preimage", "ensure_updated"]; Scheduler: ["schedule", "cancel", "schedule_named", "cancel_named", "schedule_after", "schedule_named_after", "set_retry", "set_retry_named", "cancel_retry", "cancel_retry_named"]; Utility: ["batch", "as_derivative", "batch_all", "dispatch_as", "force_batch", "with_weight", "if_else", "dispatch_as_fallible"]; Proxy: ["proxy", "add_proxy", "remove_proxy", "remove_proxies", "create_pure", "kill_pure", "announce", "remove_announcement", "reject_announcement", "proxy_announced", "poke_deposit"]; Multisig: ["as_multi_threshold_1", "as_multi", "approve_as_multi", "cancel_as_multi", "poke_deposit"]; Migrations: ["force_set_cursor", "force_set_active_cursor", "force_onboard_mbms", "clear_historic"]; Sudo: ["sudo", "sudo_unchecked_weight", "set_key", "sudo_as", "remove_key"]; XcmpQueue: ["suspend_xcm_execution", "resume_xcm_execution", "update_suspend_threshold", "update_drop_threshold", "update_resume_threshold"]; MessageQueue: ["reap_page", "execute_overweight"]; PolkadotXcm: ["send", "teleport_assets", "reserve_transfer_assets", "execute", "force_xcm_version", "force_default_xcm_version", "force_subscribe_version_notify", "force_unsubscribe_version_notify", "limited_reserve_transfer_assets", "limited_teleport_assets", "force_suspension", "transfer_assets", "claim_assets", "transfer_assets_using_type_and_then", "add_authorized_alias", "remove_authorized_alias", "remove_all_authorized_aliases"]; CollatorSelection: ["set_invulnerables", "set_desired_candidates", "set_candidacy_bond", "register_as_candidate", "leave_intent", "add_invulnerable", "remove_invulnerable", "update_bond", "take_candidate_slot"]; Session: ["set_keys", "purge_keys"]; Constitution: ["set_param", "set_capability", "set_phase_flag", "set_release_channel", "amend_registry"]; ConditionalLedger: ["split", "merge", "split_scalar", "merge_scalar", "split_gate", "merge_gate", "transfer", "split_baseline", "merge_baseline", "resolve", "void", "settle_scalar", "settle_gate", "settle_baseline", "redeem", "redeem_scalar", "redeem_scalar_pair", "redeem_gate", "redeem_void", "redeem_baseline", "redeem_baseline_pair", "sweep_dust", "sweep_dust_baseline", "set_split_paused", "set_frozen", "reconcile", "sweep_redemption_fees"]; Market: ["buy", "sell", "crank_observe", "sweep_revenue", "reap", "freeze_creation", "set_frozen"]; Welfare: ["register_spec", "record_snapshot", "record_daily_gate"]; Oracle: ["register_reporter", "deregister_reporter", "report", "challenge", "counter_report", "recompute_proof", "register_watchtower", "ack_observed", "crank_round_close", "crank_reserve_probe", "adjudicate"]; IncidentRegistry: ["file", "challenge_filing", "ack_observed", "crank_close", "resolve_challenge", "close_epoch", "reap_epoch"]; MilestoneRegistry: ["file", "challenge_filing", "ack_observed", "crank_close", "resolve_challenge", "close_epoch", "reap_epoch"]; FutarchyTreasury: ["fund_budget_line", "spend", "open_stream", "claim_stream", "cancel_stream", "issue_vit", "recover_foreign", "execute_coretime_renewal", "note_coretime_quote", "prune_coretime_quote", "set_coretime_authority", "sweep_insurance", "reconcile_insurance", "create_community_schedule", "fund_trading_rewards"]; Guardian: ["set_members", "propose_action", "approve_action", "ratify_action", "renew_playbook", "uphold_veto", "recall", "set_playbook_registered"]; Attestor: ["set_members", "attest", "challenge_attestation", "resolve_challenge", "remove_for_cause", "reap_attestation"]; Epoch: ["submit", "withdraw", "tick", "decide", "settle_cohort", "set_next_epoch_length", "delay_once", "mark_executed", "mark_failed_executed", "retry_exhausted_to_measurement", "expire_or_stale_queue", "force_reject_process_hold", "void_cohort", "set_intake_paused", "finalize_epoch_baseline", "drive_oracle_boundaries", "bind_ratification"]; ExecutionGuard: ["execute", "apply_authorized_upgrade", "expire_failed_execution", "ratify", "reject_stale", "commit_recovery_image", "authorize_phase_four", "qualify_recovery_image"]; ClientRegistry: ["admit_client", "admit_local_client", "remove_client", "top_up_delivery_float", "withdraw_delivery_float"]; QuestionService: ["register", "bond_attestor", "open", "seal", "submit_attestation", "settle", "void", "set_paused", "archive"]; ServiceLedger: ["split", "merge", "split_scalar", "merge_scalar", "split_gate", "merge_gate", "transfer", "split_baseline", "merge_baseline", "resolve", "void", "settle_scalar", "settle_gate", "settle_baseline", "redeem", "redeem_scalar", "redeem_scalar_pair", "redeem_gate", "redeem_void", "redeem_baseline", "redeem_baseline_pair", "sweep_dust", "sweep_dust_baseline", "set_split_paused", "set_frozen", "reconcile", "sweep_redemption_fees"]; TradingRewards: ["enroll", "top_up_bond", "withdraw_bond", "claim_rewards", "settle_market_score", "settle_epoch"] }; events: { System: ["ExtrinsicSuccess", "ExtrinsicFailed", "CodeUpdated", "NewAccount", "KilledAccount", "Remarked", "UpgradeAuthorized", "RejectedInvalidAuthorizedUpgrade"]; ParachainSystem: ["ValidationFunctionStored", "ValidationFunctionApplied", "ValidationFunctionDiscarded", "DownwardMessagesReceived", "DownwardMessagesProcessed", "UpwardMessageSent"]; Balances: ["Endowed", "DustLost", "Transfer", "BalanceSet", "Reserved", "Unreserved", "ReserveRepatriated", "Deposit", "Withdraw", "Slashed", "Minted", "MintedCredit", "Burned", "BurnedDebt", "Suspended", "Restored", "Upgraded", "Issued", "Rescinded", "Locked", "Unlocked", "Frozen", "Thawed", "TotalIssuanceForced", "Held", "BurnedHeld", "TransferOnHold", "TransferAndHold", "Released", "Unexpected"]; ForeignAssets: ["Created", "Issued", "Transferred", "Burned", "TeamChanged", "OwnerChanged", "Frozen", "Thawed", "AssetFrozen", "AssetThawed", "AccountsDestroyed", "ApprovalsDestroyed", "DestructionStarted", "Destroyed", "ForceCreated", "MetadataSet", "MetadataCleared", "ApprovedTransfer", "ApprovalCancelled", "TransferredApproved", "AssetStatusChanged", "AssetMinBalanceChanged", "Touched", "Blocked", "Deposited", "Withdrawn", "ReservesUpdated", "ReservesRemoved", "IssuedCredit", "BurnedCredit", "IssuedDebt", "BurnedDebt"]; TransactionPayment: ["TransactionFeePaid"]; AssetTxPayment: ["AssetTxFeePaid"]; Vesting: ["VestingCreated", "VestingUpdated", "VestingCompleted"]; Referenda: ["Submitted", "DecisionDepositPlaced", "DecisionDepositRefunded", "DepositSlashed", "DecisionStarted", "ConfirmStarted", "ConfirmAborted", "Confirmed", "Approved", "Rejected", "TimedOut", "Cancelled", "Killed", "SubmissionDepositRefunded", "MetadataSet", "MetadataCleared"]; ConvictionVoting: ["Delegated", "Undelegated", "Voted", "VoteRemoved", "VoteUnlocked"]; Preimage: ["Noted", "Requested", "Cleared"]; Scheduler: ["Scheduled", "Canceled", "Dispatched", "RetrySet", "RetryCancelled", "CallUnavailable", "PeriodicFailed", "RetryFailed", "PermanentlyOverweight", "AgendaIncomplete"]; Utility: ["BatchInterrupted", "BatchCompleted", "BatchCompletedWithErrors", "ItemCompleted", "ItemFailed", "DispatchedAs", "IfElseMainSuccess", "IfElseFallbackCalled"]; Proxy: ["ProxyExecuted", "PureCreated", "PureKilled", "Announced", "ProxyAdded", "ProxyRemoved", "DepositPoked"]; Multisig: ["NewMultisig", "MultisigApproval", "MultisigExecuted", "MultisigCancelled", "DepositPoked"]; Migrations: ["UpgradeStarted", "UpgradeCompleted", "UpgradeFailed", "MigrationSkipped", "MigrationAdvanced", "MigrationCompleted", "MigrationFailed", "HistoricCleared"]; Sudo: ["Sudid", "KeyChanged", "KeyRemoved", "SudoAsDone"]; XcmpQueue: ["XcmpMessageSent"]; MessageQueue: ["ProcessingFailed", "Processed", "OverweightEnqueued", "PageReaped"]; CumulusXcm: ["InvalidFormat", "UnsupportedVersion", "ExecutedDownward"]; PolkadotXcm: ["Attempted", "Sent", "SendFailed", "ProcessXcmError", "UnexpectedResponse", "ResponseReady", "Notified", "NotifyOverweight", "NotifyDispatchError", "NotifyDecodeFailed", "InvalidResponder", "InvalidResponderVersion", "ResponseTaken", "AssetsTrapped", "VersionChangeNotified", "SupportedVersionChanged", "NotifyTargetSendFail", "NotifyTargetMigrationFail", "InvalidQuerierVersion", "InvalidQuerier", "VersionNotifyStarted", "VersionNotifyRequested", "VersionNotifyUnrequested", "FeesPaid", "AssetsClaimed", "VersionMigrationFinished", "AliasAuthorized", "AliasAuthorizationRemoved", "AliasesAuthorizationsRemoved"]; CollatorSelection: ["NewInvulnerables", "InvulnerableAdded", "InvulnerableRemoved", "NewDesiredCandidates", "NewCandidacyBond", "CandidateAdded", "CandidateBondUpdated", "CandidateRemoved", "CandidateReplaced", "InvalidInvulnerableSkipped"]; Session: ["NewSession", "NewQueued", "ValidatorDisabled", "ValidatorReenabled"]; Constitution: ["ParamUpdated", "CapabilitySet", "PhaseFlagSet", "ReleaseChannelSet", "RegistryAmended", "MeterCharged"]; ConditionalLedger: ["Split", "Merged", "ScalarSplit", "ScalarMerged", "GateSplit", "GateMerged", "PositionTransferred", "BaselineSplit", "BaselineMerged", "VaultResolved", "VaultVoided", "ScalarSettlementSet", "GateSettled", "BaselineSettled", "Redeemed", "ScalarRedeemed", "ScalarPairRedeemed", "GateRedeemed", "VoidRedeemed", "BaselineRedeemed", "RedemptionFeesSwept", "VaultReaped", "BaselineVaultReaped", "SplitPauseSet", "SplitPauseCleared", "FreezeSet", "FreezeCleared", "FreezeExtended", "LedgerDriftDetected", "LedgerDriftCleared"]; Market: ["Traded", "Observed", "MarketCreated", "MarketClosed", "MarketReaped", "Seeded", "CreationFreezeSet", "CreationFreezeCleared", "FreezeSet", "FreezeCleared", "FreezeExtended", "RevenueSwept", "ExternalRevenueSwept"]; Welfare: ["MetricSpecRegistered", "SnapshotRecorded", "GateBreachRecorded", "SettlementComputed", "SettlementRenormalized", "IntegrityFailureRecorded"]; Oracle: ["ReporterRegistered", "Reported", "Challenged", "RoundEscalated", "RecomputeProven", "AdjudicationRequested", "Adjudicated", "ComponentSettled", "NeutralSettlement", "WindowAcknowledged", "WindowExtended", "QuorumFailed", "ReporterSlashed", "ReporterEjected", "WatchtowerRegistered", "WatchtowerInactive", "WatchtowerSlashed", "ReserveProbeSent", "ReserveProbeResult", "ReserveUnhealthy", "ReserveRecovered", "RetentionExpired", "ReporterRecordsFull"]; IncidentRegistry: ["IncidentFiled", "MilestoneFiled", "IncidentChallenged", "MilestoneChallenged", "IncidentUpheld", "IncidentRejected", "MilestoneAccepted", "MilestoneRejected", "FilingBondSlashed", "RegistryEpochClosed", "WindowAcknowledged", "WindowExtended"]; MilestoneRegistry: ["IncidentFiled", "MilestoneFiled", "IncidentChallenged", "MilestoneChallenged", "IncidentUpheld", "IncidentRejected", "MilestoneAccepted", "MilestoneRejected", "FilingBondSlashed", "RegistryEpochClosed", "WindowAcknowledged", "WindowExtended"]; FutarchyTreasury: ["Spent", "StreamOpened", "StreamClaimed", "StreamCancelled", "BudgetLineFunded", "VitIssued", "NavHaircutFlagged", "ForeignRecovered", "CoretimeRenewalCalled", "ReserveProbeFeeCharged", "NavFloorUnmet", "KeeperBudgetLow", "KeeperBudgetExhausted", "CoretimeQuoteNoted", "CoretimeQuotePruned", "CoretimeAuthoritySet", "InsuranceSwept", "InsuranceOverflowed", "PolCustodyMoved", "CommunityScheduleCreated", "TradingRewardsFunded", "TradingRewardBudgetReturned"]; Guardian: ["GuardianAction", "ForceRerun", "PlaybookActivated", "PlaybookRenewed", "PlaybookExpired", "ReviewScheduled", "MembersSet", "ActionProposed", "ActionApproved", "ActionRatified", "ReviewFailed", "RecallScheduled", "RecallEnacted", "PlaybookRegistrationSet"]; Attestor: ["MembersSet", "AttestationSubmitted", "AttestationChallenged", "ChallengeResolved", "AttestorEjected", "AttestorRemovedForCause", "AttestationRevoked"]; Epoch: ["ProposalSubmitted", "ProposalWithdrawn", "ScreeningStarted", "ProposalCancelled", "ProposalQualified", "ProposalDeferred", "SlotsShrunk", "MarketsOpened", "DecisionExtended", "ProposalQueued", "ProposalRejected", "ProposalDelayed", "RerunScheduled", "RerunOpened", "MandateExpired", "MeasurementStarted", "CohortSettled", "CohortVoided", "BaselineCarried", "ProposalForceRejected", "IntakeSlashed", "IntakePauseSet", "IntakePauseCleared", "OracleDeadlockLatched", "OracleDeadlockCleared"]; ExecutionGuard: ["Executed", "ExecutionFailed", "Ratified", "UpgradeAuthorized", "Enqueued", "Rejected", "UpgradeApplied", "PreimageUnpinned", "UpgradeAborted", "PendingOutflowSyncFailed", "MigrationHalted", "RecoveryImageCommitted", "RecoveryImageApplied", "PhaseFourUpgradeAuthorized", "RecoveryImageQualified"]; ClientRegistry: ["ClientAdmitted", "LocalClientAdmitted", "ClientRemovalStarted", "ClientRemoved", "EgressPrepaid", "DeliveryFloatToppedUp", "DeliveryFloatWithdrawn"]; QuestionService: ["QuestionRegistered", "QuestionSealed", "QuestionSettled", "QuestionVoided", "AttestorBonded", "AttestationSubmitted", "ServicePauseSet", "ServicePauseCleared", "QuestionArchived"]; ServiceLedger: ["Split", "Merged", "ScalarSplit", "ScalarMerged", "GateSplit", "GateMerged", "PositionTransferred", "BaselineSplit", "BaselineMerged", "VaultResolved", "VaultVoided", "ScalarSettlementSet", "GateSettled", "BaselineSettled", "Redeemed", "ScalarRedeemed", "ScalarPairRedeemed", "GateRedeemed", "VoidRedeemed", "BaselineRedeemed", "RedemptionFeesSwept", "VaultReaped", "BaselineVaultReaped", "SplitPauseSet", "SplitPauseCleared", "FreezeSet", "FreezeCleared", "FreezeExtended", "LedgerDriftDetected", "LedgerDriftCleared"]; TradingRewards: ["Enrolled", "BondToppedUp", "BondWithdrawn", "RewardsClaimed", "MarketScoreFolded", "MarketScoreDropped", "EpochSettled"] }; errors: { System: ["InvalidSpecName", "SpecVersionNeedsToIncrease", "FailedToExtractRuntimeVersion", "NonDefaultComposite", "NonZeroRefCount", "CallFiltered", "MultiBlockMigrationsOngoing", "NothingAuthorized", "Unauthorized"]; ParachainSystem: ["OverlappingUpgrades", "ProhibitedByPolkadot", "TooBig", "ValidationDataNotAvailable", "HostConfigurationNotAvailable", "NotScheduled"]; Balances: ["VestingBalance", "LiquidityRestrictions", "InsufficientBalance", "ExistentialDeposit", "Expendability", "ExistingVestingSchedule", "DeadAccount", "TooManyReserves", "TooManyHolds", "TooManyFreezes", "IssuanceDeactivated", "DeltaZero"]; ForeignAssets: ["BalanceLow", "NoAccount", "NoPermission", "Unknown", "Frozen", "InUse", "BadWitness", "MinBalanceZero", "UnavailableConsumer", "BadMetadata", "Unapproved", "WouldDie", "AlreadyExists", "NoDeposit", "WouldBurn", "LiveAsset", "AssetNotLive", "IncorrectStatus", "NotFrozen", "CallbackFailed", "BadAssetId", "ContainsFreezes", "ContainsHolds", "TooManyReserves"]; Vesting: ["NotVesting", "AtMaxVestingSchedules", "AmountLow", "ScheduleIndexOutOfBounds", "InvalidScheduleParams"]; Referenda: ["NotOngoing", "HasDeposit", "BadTrack", "Full", "QueueEmpty", "BadReferendum", "NothingToDo", "NoTrack", "Unfinished", "NoPermission", "NoDeposit", "BadStatus", "PreimageNotExist", "PreimageStoredWithDifferentLength"]; ConvictionVoting: ["NotOngoing", "NotVoter", "NoPermission", "NoPermissionYet", "AlreadyDelegating", "AlreadyVoting", "InsufficientFunds", "NotDelegating", "Nonsense", "MaxVotesReached", "ClassNeeded", "BadClass"]; Preimage: ["TooBig", "AlreadyNoted", "NotAuthorized", "NotNoted", "Requested", "NotRequested", "TooMany", "TooFew"]; Scheduler: ["FailedToSchedule", "NotFound", "TargetBlockNumberInPast", "RescheduleNoChange", "Named"]; Utility: ["TooManyCalls"]; Proxy: ["TooMany", "NotFound", "NotProxy", "Unproxyable", "Duplicate", "NoPermission", "Unannounced", "NoSelfProxy"]; Multisig: ["MinimumThreshold", "AlreadyApproved", "NoApprovalsNeeded", "TooFewSignatories", "TooManySignatories", "SignatoriesOutOfOrder", "SenderInSignatories", "NotFound", "NotOwner", "NoTimepoint", "WrongTimepoint", "UnexpectedTimepoint", "MaxWeightTooLow", "AlreadyStored"]; Migrations: ["Ongoing"]; Sudo: ["RequireSudo"]; XcmpQueue: ["BadQueueConfig", "AlreadySuspended", "AlreadyResumed", "TooManyActiveOutboundChannels", "TooBig"]; MessageQueue: ["NotReapable", "NoPage", "NoMessage", "AlreadyProcessed", "Queued", "InsufficientWeight", "TemporarilyUnprocessable", "QueuePaused", "RecursiveDisallowed"]; PolkadotXcm: ["Unreachable", "SendFailure", "Filtered", "UnweighableMessage", "DestinationNotInvertible", "Empty", "CannotReanchor", "TooManyAssets", "InvalidOrigin", "BadVersion", "BadLocation", "NoSubscription", "AlreadySubscribed", "CannotCheckOutTeleport", "LowBalance", "TooManyLocks", "AccountNotSovereign", "FeesNotMet", "LockNotFound", "InUse", "InvalidAssetUnknownReserve", "InvalidAssetUnsupportedReserve", "TooManyReserves", "LocalExecutionIncomplete", "TooManyAuthorizedAliases", "ExpiresInPast", "AliasNotFound", "LocalExecutionIncompleteWithError"]; CollatorSelection: ["TooManyCandidates", "TooFewEligibleCollators", "AlreadyCandidate", "NotCandidate", "TooManyInvulnerables", "AlreadyInvulnerable", "NotInvulnerable", "NoAssociatedValidatorId", "ValidatorNotRegistered", "InsertToCandidateListFailed", "RemoveFromCandidateListFailed", "DepositTooLow", "UpdateCandidateListFailed", "InsufficientBond", "TargetIsNotCandidate", "IdenticalDeposit", "InvalidUnreserve"]; Session: ["InvalidProof", "NoAssociatedValidatorId", "DuplicatedKey", "NoKeys", "NoAccount"]; Constitution: ["UnknownParam", "UnknownMeter", "WrongType", "BelowMin", "AboveMax", "DeltaTooLarge", "CooldownActive", "MeterOverflow", "MeterExhausted", "ReservedPhaseFlag", "FlagNotArmable", "BadReleaseSchema", "TooManyParams", "TooManyMeters", "TooManyCapabilities", "KernelBoundImmutable", "MetaBoundViolation", "TryStateViolation", "NavFloorUnmet", "BudgetDerivationRequired", "PhaseCapRaiseRefused", "CoverageBreaksAdmission", "RedemptionFeeAboveMarketFee", "RewardRateAboveWashBreakeven"]; ConditionalLedger: ["BadOrigin", "UnknownVault", "UnknownBaselineVault", "WrongVaultState", "BelowMinimum", "ArithmeticOverflow", "InsufficientPosition", "TooManyPositions", "InvalidScore", "GateAlreadySettled", "GateNotSettled", "TryStateViolation", "ReapNotDue", "DepositFailed", "SplitPaused", "Frozen", "FreezeOutOfBounds", "FreezeRenewalExhausted", "InflowCapExceeded", "ProtocolDestination"]; Market: ["UnknownMarket", "DuplicateMarket", "DuplicateBaselineMarket", "NotTrading", "AmountTooSmall", "AmountTooLarge", "SlippageExceeded", "PriceBoundExceeded", "ArithmeticOverflow", "Ledger", "TryStateViolation", "BadOrigin", "NotReapable", "TooManyMarkets", "TooManyStoredMarkets", "AlreadySeeded", "CreationFrozen", "Frozen", "FreezeOutOfBounds", "FreezeRenewalExhausted", "UnreservedProtocolAccount", "EpochMismatch", "NotSweepable", "TooManyExternalMarkets", "WrongFundingDomain", "FunderMismatch", "DuplicateExternalQuestion", "InvalidIdBand"]; Welfare: ["TooManyMetricSpecs", "TooManySnapshots", "TooManyComponents", "TooManyGateFlags", "DuplicateSpecVersion", "SpecNotFound", "BadActivationEpoch", "SpecNotActive", "MissingMetricDiscipline", "BadEpsilonFloor", "BadSourceClass", "BadWeightSum", "ValueOutOfRange", "MissingComponent", "DuplicateComponent", "DuplicateSnapshot", "ArithmeticOverflow", "TryStateViolation", "BadParams", "EpochNotFinalized", "GateWindowUnsampled", "MilestoneTargetUnset", "BadDeltaSMax", "InsufficientOracleSeats", "BondCoverageUnmet", "IncidentAggregateUnavailable", "BadFlaggedComponent", "MissingSnapshotContext", "EmptyNormalizationSample", "DegenerateNormalizationRange", "DayOutsideEpoch", "SpecVersionNotAdmissible"]; Oracle: ["AlreadyRegistered", "NotRegistered", "TooManyReporters", "TooManyWatchtowers", "WindowClosed", "WindowOpen", "BondBelowMinimum", "SpecVersionMismatch", "AlreadyFinal", "AlreadyChallenged", "QuorumPending", "RoundNotFound", "RoundLimit", "DuplicateAck", "ReserveUnhealthy", "ProbeTooEarly", "ProbeUnavailable", "UnknownQuery", "Overflow", "NotRecomputable", "ProofTooLarge", "EvidenceMismatch", "BadProof", "ValueOutOfBounds", "SelfChallenge", "ReporterEjected", "TryStateViolation", "ReporterRecordsSaturated"]; IncidentRegistry: ["EpochFull", "TooManyLiveEpochs", "TooManyAggregates", "WindowClosed", "WindowOpen", "AlreadyChallenged", "AlreadyFinal", "SpecVersionMismatch", "BondBelowMinimum", "FilingNotFound", "DuplicateAck", "BatchTooLarge", "InvalidClass", "Overflow", "NotRegistered", "TryStateViolation", "BadAccount", "AlreadyQuorum", "ReapNotDue", "NothingToClose", "MilestoneTargetUnset", "ExposureUnavailable", "EvidenceMismatch"]; MilestoneRegistry: ["EpochFull", "TooManyLiveEpochs", "TooManyAggregates", "WindowClosed", "WindowOpen", "AlreadyChallenged", "AlreadyFinal", "SpecVersionMismatch", "BondBelowMinimum", "FilingNotFound", "DuplicateAck", "BatchTooLarge", "InvalidClass", "Overflow", "NotRegistered", "TryStateViolation", "BadAccount", "AlreadyQuorum", "ReapNotDue", "NothingToClose", "MilestoneTargetUnset", "ExposureUnavailable", "EvidenceMismatch"]; FutarchyTreasury: ["UnknownBudgetLine", "InsufficientFunds", "ReserveImpaired", "ProposalCapExceeded", "StreamRequired", "MeterExhausted", "StreamNotFound", "StreamNotClaimable", "NotRecipient", "AlreadyCancelled", "BadDuration", "RenewalWindowClosed", "PeriodAlreadyFunded", "TooManyStreams", "TooManyBudgetLines", "TooManyObligations", "IssuanceLineNotAllowed", "IssuanceCapExceeded", "UnknownForeignAsset", "NavFloorUnmet", "ZeroQuote", "Overflow", "NotQuoteAuthority", "BootstrapOpsLineOnly", "BootstrapOpsFundingClosed", "BootstrapOpsFundingLimit", "RenewalAccountUnset", "QuoteExpired", "QuoteNotExpired", "RateUnset", "FeeBudgetUnset", "QuoteTtlUnset", "QuoteTimestampInFuture", "CommunityDistributionNotArmed", "CommunityDistributionAmountTooSmall", "CommunityDistributionExhausted", "TooManyCommunitySchedules", "CommunityVestingDurationInvalid", "CommunityBeneficiaryIsPot", "OutflowCustodyUnwired", "IncentiveAllocationExhausted", "TooManyTradingRewardAuthorizations"]; Guardian: ["NotInitialized", "NotMember", "DuplicateMember", "DuplicateApproval", "ActionNotFound", "ActionExpired", "AlreadyDispatched", "TooManyPending", "TooManyApprovals", "TooManyReviews", "TooManyActivePlaybooks", "TooManyReruns", "ThresholdNotMet", "AllowanceExhausted", "DurationTooLong", "TriggerInactive", "BadPlaybookTrigger", "BadPlaybookTarget", "AlreadyRerun", "NotRerunnable", "ReviewNotFound", "AlreadyRatified", "RenewalNotAllowed", "PlaybookAlreadyActive", "Overflow", "TryStateViolation", "FailedActionNotFound", "NotDelayAction", "TooManyBondReleases", "BondAccounting", "PlaybookNotRegistered"]; Attestor: ["NotMember", "DuplicateMember", "TooFewMembers", "AttestationNotFound", "DuplicateAttestation", "ChallengeWindowClosed", "ChallengeAlreadyOpen", "ChallengeBondTooSmall", "ChallengeStillOpen", "QuorumMissing", "NoOpenChallenge", "EjectedMemberActive", "Overflow", "NotInitialized", "TooManyAttestors", "TooManyAttestations", "TooManyLiabilities", "TooManyRevocations", "LiabilityExists", "AttestorNotFound", "LiabilityNotFound", "ProposalNotTerminal", "ChallengeOpen", "ReapNotAllowed", "BondAccounting", "UnknownProposal", "AttestorQuotaExceeded"]; Epoch: ["BadPhase", "IntakeFull", "TooManyLiveProposals", "TooManyResources", "UnknownProposal", "BadState", "DuplicateProposal", "LockConflict", "TooManyCohorts", "TooManyCohortProposals", "BadEpochLength", "BadParams", "BadDecisionInput", "BatchTooLarge", "ArithmeticOverflow", "Ledger", "ExecutionGuard", "Welfare", "TryStateViolation", "BadProposalShape", "IntakePaused", "IntakePauseOutOfBounds"]; ExecutionGuard: ["QueueFull", "NotFound", "Cancelled", "NotMature", "GraceExpired", "BadPreimage", "StaleQueue", "NotRatified", "AttestationMissing", "CapabilityDenied", "MetersBlocked", "ResourceLockMissing", "GuardianHold", "GateSuspended", "FreezeActive", "PayloadTooLarge", "TooManyCalls", "TooManyDomains", "TooManyLocks", "BadDomainDeclaration", "SafetyFilter", "DispatchFailed", "BadUpgradePayload", "PendingUpgradeExists", "NoPendingUpgrade", "DescriptorLeadTime", "UpgradeHashMismatch", "UpgradeVersionMismatch", "RecoveryImageMissing", "RecoveryImageInvalid", "ShadowMode", "PhaseFourBridgeUsed", "JustificationMissing", "RetryWindowOpen", "Overflow"]; ClientRegistry: ["ClientBondUnset", "DuplicateLocation", "ClientsFull", "ClientIdExhausted", "NotRegistered", "ClientRemoved", "QuestionCounterOverflow", "NoLiveQuestions", "BondInsufficient", "BondAccounting", "DeliveryFloatAmountZero", "DeliveryFloatInsufficient", "DeliveryFloatWouldDrain", "DeliveryFloatBelowMinimum", "DeliveryFundingWouldDust", "DeliveryFloatOverflow", "DeliveryFloatAccounting"]; QuestionService: ["NotRegistered", "ClientRemoved", "ServicePaused", "ServiceRateUnset", "CertificationUnavailable", "StakeBelowFloor", "ArmingBoundExceeded", "SubsidyBelowMinimum", "EpsilonOutOfRange", "WindowTooLong", "WindowTooShort", "WindowCollidesWithDecision", "SlotsExhausted", "TvlCapWouldBind", "AttestorSetTooSmall", "AttestorBondInsufficient", "ClientIsProtocolAccount", "EscrowInsufficient", "NotSealed", "AlreadySealed", "AlreadyTerminal", "QuorumNotReached", "MedianOutOfRange", "DeadlineNotReached", "UnknownQuestion", "DeadlinePassed", "CreationFrozen", "DuplicateAttestor", "UnknownAttestor", "AlreadyBonded", "InvalidSubId", "ArithmeticOverflow", "ArchiveNotReady", "TryStateViolation"]; ServiceLedger: ["BadOrigin", "UnknownVault", "UnknownBaselineVault", "WrongVaultState", "BelowMinimum", "ArithmeticOverflow", "InsufficientPosition", "TooManyPositions", "InvalidScore", "GateAlreadySettled", "GateNotSettled", "TryStateViolation", "ReapNotDue", "DepositFailed", "SplitPaused", "Frozen", "FreezeOutOfBounds", "FreezeRenewalExhausted", "InflowCapExceeded", "ProtocolDestination"]; TradingRewards: ["AlreadyEnrolled", "NotEnrolled", "RateUnset", "MinimumBondUnset", "BondBelowMinimum", "TooManyParticipants", "AmountZero", "AccountingOverflow", "EpochUnsettled", "NothingToClaim", "VitRateUnset", "BondCustody", "RewardCustody", "BondFundingWouldDust", "NoScoreEntry", "MarketNotSettled", "EpochNotClosed", "UnfoldedScore", "BudgetExceeded", "ThirdPartyWouldClampReward"] }; constants: { System: ["BlockWeights", "BlockLength", "BlockHashCount", "DbWeight", "Version", "SS58Prefix"]; Timestamp: ["MinimumPeriod"]; ParachainSystem: ["SelfParaId"]; Balances: ["ExistentialDeposit", "MaxLocks", "MaxReserves", "MaxFreezes"]; ForeignAssets: ["RemoveItemsLimit", "AssetDeposit", "AssetAccountDeposit", "MetadataDepositBase", "MetadataDepositPerByte", "ApprovalDeposit", "StringLimit"]; TransactionPayment: ["OperationalFeeMultiplier"]; Vesting: ["MinVestedTransfer", "MaxVestingSchedules"]; Referenda: ["SubmissionDeposit", "MaxQueued", "UndecidingTimeout", "AlarmInterval", "Tracks"]; ConvictionVoting: ["MaxVotes", "VoteLockingPeriod"]; Scheduler: ["MaximumWeight", "MaxScheduledPerBlock"]; Utility: ["batched_calls_limit"]; Proxy: ["ProxyDepositBase", "ProxyDepositFactor", "MaxProxies", "MaxPending", "AnnouncementDepositBase", "AnnouncementDepositFactor"]; Multisig: ["DepositBase", "DepositFactor", "MaxSignatories"]; Migrations: ["CursorMaxLen", "IdentifierMaxLen"]; XcmpQueue: ["MaxInboundSuspended", "MaxActiveOutboundChannels", "MaxPageSize"]; MessageQueue: ["HeapSize", "MaxStale", "ServiceWeight", "IdleMaxServiceWeight"]; PolkadotXcm: ["UniversalLocation", "AdvertisedXcmVersion", "MaxLockers", "MaxRemoteLockConsumers"]; CollatorSelection: ["PotId", "MaxCandidates", "MinEligibleCollators", "MaxInvulnerables", "KickThreshold", "pot_account"]; Session: ["KeyDeposit"]; Aura: ["SlotDuration"]; Constitution: ["INTEGRATION_CONTRACT_VERSION", "MaxParams", "MaxCapabilities", "MaxMeters"]; ConditionalLedger: ["MinSplit", "PositionDeposit", "MaxPositionsPerAccount", "ArchiveDelay", "ReapBatch", "PalletId", "MinTransfer", "RedemptionFee", "ServiceIdBase"]; Market: ["Fee", "ObsInterval", "Kappa1e9", "ArchiveDelay", "PalletId", "MinTrade", "MaxTradeRatio", "MaxLiveMarkets", "MaxStoredMarkets", "MaxLiveExternalMarkets", "MaxStoredExternalMarkets", "MaxAllStoredMarkets", "GatePMaxCeiling", "GateEpsFloor"]; Welfare: ["INTEGRATION_CONTRACT_VERSION", "MaxMetricSpecs", "MaxSnapshots", "MaxGateFlags", "MaxDailyGateSamples"]; Oracle: ["MaxRoundCloseBatch"]; IncidentRegistry: ["Kind", "PalletId", "ArchiveDelay", "MaxFilingsPerEpoch", "MaxEvidenceLen"]; MilestoneRegistry: ["Kind", "PalletId", "ArchiveDelay", "MaxFilingsPerEpoch", "MaxEvidenceLen"]; FutarchyTreasury: ["INTEGRATION_CONTRACT_VERSION", "MaxStreams", "MaxBudgetLines", "MaxPolCommitments", "MaxCollatorCompensationEntries"]; Guardian: ["GuardianSeats", "GuardianThreshold", "GuardianBond", "PlaybookFreezeWindowBlocks", "DelayOnceAllowancePerEpoch", "ForceRerunAllowancePerEpoch", "PauseIntakeAllowanceWindowEpochs", "PauseIntakeAllowance"]; Attestor: ["AttMinMembers", "AttQuorum", "ChallengeWindowBlocks"]; Epoch: ["INTEGRATION_CONTRACT_VERSION", "TreasuryBondAskBps", "MaxLiveProposals", "MaxIntakeQueue", "MaxNonTerminalCohorts", "RecentCohortSummariesBound", "TickBatch", "PhaseOffsets", "MaxBooksPerProposal", "MinEpochLength", "DecisionWindowFloor", "DecisionExtension", "DecisionDeltaFloors", "DecisionSigmaFloors"]; ExecutionGuard: ["MaxRuntimeCodeBytes", "INTEGRATION_CONTRACT_VERSION", "MaxLiveProposals", "MaxExecutionRecords", "MaxCalls", "MaxPayloadBytes", "DescriptorLeadTime", "MaxRuntimeCodeBytes", "ExecutionTimelockFloor", "ExecutionGraceFloor"]; ClientRegistry: ["DeliveryAssetId", "DeliveryFloatPalletId", "MaxClients", "ClientBond"]; QuestionService: ["PalletId", "FeeFloor", "MaxLive", "MaxWindow", "EpsilonMin", "AttestorsMin"]; ServiceLedger: ["MinSplit", "PositionDeposit", "MaxPositionsPerAccount", "ArchiveDelay", "ReapBatch", "PalletId", "MinTransfer", "RedemptionFee", "ServiceIdBase"]; TradingRewards: ["UsdcAssetId", "PalletId", "MaxParticipants", "MaxScoredMarketsPerAccount"] }; viewFns: {}; apis: { Core: ["version", "execute_block", "initialize_block"]; Metadata: ["metadata", "metadata_at_version", "metadata_versions"]; RuntimeViewFunction: ["execute_view_function"]; FutarchyApi: ["epoch_status", "proposal_summaries", "quote", "decision_stats", "account_positions", "execution_queue", "welfare_current", "params", "nav", "recent_cohorts", "open_oracle_rounds", "hosted_report", "service_positions", "is_reserved_protocol_destination", "bond_quote", "treasury_streams"]; TelemetryApi: ["market_books", "mid_window_coverage", "pol", "collateral", "service_collateral", "reserve_probe_line_balance", "migration_cursor_stalled", "storage_utilization", "service_egress", "service_partition"]; ReleaseMetadataApi: ["embedded_rfc78_metadata_hash"]; BlockBuilder: ["apply_extrinsic", "finalize_block", "inherent_extrinsics", "check_inherents"]; TaggedTransactionQueue: ["validate_transaction"]; OffchainWorkerApi: ["offchain_worker"]; SessionKeys: ["generate_session_keys", "decode_session_keys"]; AuraApi: ["slot_duration", "authorities"]; AuraUnincludedSegmentApi: ["can_build_upon"]; RelayParentOffsetApi: ["relay_parent_offset", "max_claim_queue_offset"]; GetParachainInfo: ["parachain_id"]; KeyToIncludeInRelayProof: ["keys_to_prove"]; AccountNonceApi: ["account_nonce"]; TransactionPaymentApi: ["query_info", "query_fee_details", "query_weight_to_fee", "query_length_to_fee"]; TransactionPaymentCallApi: ["query_call_info", "query_call_fee_details", "query_weight_to_fee", "query_length_to_fee"]; CollectCollationInfo: ["collect_collation_info"]; GenesisBuilder: ["build_state", "get_preset", "preset_names"] } };
export type Bleavit_recoveryWhitelistEntry = PalletKey | `query.${NestedKey<AllInteractions["storage"]>}` | `tx.${NestedKey<AllInteractions["tx"]>}` | `event.${NestedKey<AllInteractions["events"]>}` | `error.${NestedKey<AllInteractions["errors"]>}` | `const.${NestedKey<AllInteractions["constants"]>}` | `view.${NestedKey<AllInteractions["viewFns"]>}` | `api.${NestedKey<AllInteractions["apis"]>}`;
type PalletKey = `*.${{ [K in keyof AllInteractions]: K extends "apis" ? never : keyof AllInteractions[K] }[keyof AllInteractions]}`;
type NestedKey<D extends Record<string, string[]>> = "*" | { [P in keyof D & string]: `${P}.*` | `${P}.${D[P][number]}` }[keyof D & string];
